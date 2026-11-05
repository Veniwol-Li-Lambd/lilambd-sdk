// Package lilambd is a Go client for the Lilambd Data for Agents API
// (https://api.lilambd.com): pay-per-call datasets over x402 (USDC on Base),
// with free 3-row samples and an optional RapidAPI mode.
//
// Quick start:
//
//	c := lilambd.New()
//	raw, err := c.Airports().Search(ctx, lilambd.Params{"q": "tokyo", "sample": "1"})
package lilambd

//go:generate go run ./internal/gen -catalog ../spec/catalog.json -out products_gen.go -copy catalog.json

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

// Version is the SDK version.
const Version = "0.1.0"

// DefaultBaseURL is the public API endpoint.
const DefaultBaseURL = "https://api.lilambd.com"

// Header names used by the x402 payment flow.
const (
	HeaderPaymentRequired  = "PAYMENT-REQUIRED"
	HeaderPaymentSignature = "PAYMENT-SIGNATURE"
	HeaderXPayment         = "X-PAYMENT"
	HeaderPaymentResponse  = "PAYMENT-RESPONSE"
)

// Params are query and path parameters for a call. Keys matching a
// {placeholder} in the route are substituted into the path; the rest are
// sent as query parameters.
type Params map[string]string

// PaymentSigner turns payment requirements from a 402 response into a
// payment payload (typically a base64-encoded x402 PaymentPayload) that is
// sent in the PAYMENT-SIGNATURE header on retry.
type PaymentSigner func(ctx context.Context, req *PaymentRequirements) (string, error)

// Client talks to the Lilambd API. It is safe for concurrent use.
type Client struct {
	baseURL       string
	httpClient    *http.Client
	signer        PaymentSigner
	paymentHeader string
	rapidKey      string
	rapidHost     string
	userAgent     string
	headers       http.Header
}

// Option configures a Client.
type Option func(*Client)

// WithBaseURL overrides the API base URL (e.g. a RapidAPI gateway or a test server).
func WithBaseURL(u string) Option {
	return func(c *Client) { c.baseURL = strings.TrimRight(u, "/") }
}

// WithHTTPClient sets the underlying *http.Client.
func WithHTTPClient(h *http.Client) Option {
	return func(c *Client) {
		if h != nil {
			c.httpClient = h
		}
	}
}

// WithPaymentSigner installs an x402 signer. When a call returns HTTP 402,
// the client calls the signer and retries once with the payment header.
func WithPaymentSigner(s PaymentSigner) Option {
	return func(c *Client) { c.signer = s }
}

// WithPaymentHeader changes the header used to send payment payloads
// (default PAYMENT-SIGNATURE; X-PAYMENT is also accepted by the API).
func WithPaymentHeader(name string) Option {
	return func(c *Client) {
		if name != "" {
			c.paymentHeader = name
		}
	}
}

// WithRapidAPI enables RapidAPI mode: every request carries x-rapidapi-key
// and x-rapidapi-host. If no base URL was set, https://{host} is used.
func WithRapidAPI(key, host string) Option {
	return func(c *Client) {
		c.rapidKey = key
		c.rapidHost = host
	}
}

// WithUserAgent overrides the User-Agent header.
func WithUserAgent(ua string) Option {
	return func(c *Client) { c.userAgent = ua }
}

// WithHeader adds a static header to every request.
func WithHeader(key, value string) Option {
	return func(c *Client) { c.headers.Add(key, value) }
}

// New creates a client.
func New(opts ...Option) *Client {
	c := &Client{
		httpClient:    &http.Client{Timeout: 60 * time.Second},
		paymentHeader: HeaderPaymentSignature,
		userAgent:     "lilambd-go/" + Version,
		headers:       http.Header{},
	}
	for _, o := range opts {
		o(c)
	}
	if c.baseURL == "" {
		if c.rapidHost != "" {
			c.baseURL = "https://" + c.rapidHost
		} else {
			c.baseURL = DefaultBaseURL
		}
	}
	return c
}

// BaseURL returns the configured base URL.
func (c *Client) BaseURL() string { return c.baseURL }

// BuildURL returns the full request URL for product+route with params applied.
// {placeholders} in route are replaced (path-escaped) from params; remaining
// params become a sorted query string. A missing placeholder is an error.
func (c *Client) BuildURL(product, route string, params Params) (string, error) {
	path, query, err := expandRoute(route, params)
	if err != nil {
		return "", err
	}
	u := c.baseURL
	if product != "" {
		u += "/" + strings.Trim(product, "/")
	}
	if path != "" && path != "/" {
		if !strings.HasPrefix(path, "/") {
			path = "/" + path
		}
		u += path
	} else if product == "" {
		u += "/"
	}
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	return u, nil
}

func expandRoute(route string, params Params) (string, url.Values, error) {
	used := map[string]bool{}
	var b strings.Builder
	for i := 0; i < len(route); {
		if route[i] == '{' {
			j := strings.IndexByte(route[i:], '}')
			if j < 0 {
				return "", nil, fmt.Errorf("lilambd: unterminated placeholder in %q", route)
			}
			name := route[i+1 : i+j]
			v, ok := params[name]
			if !ok || v == "" {
				return "", nil, fmt.Errorf("lilambd: missing path parameter %q for route %q", name, route)
			}
			b.WriteString(url.PathEscape(v))
			used[name] = true
			i += j + 1
			continue
		}
		b.WriteByte(route[i])
		i++
	}
	q := url.Values{}
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if !used[k] {
			q.Set(k, params[k])
		}
	}
	return b.String(), q, nil
}

// Get calls GET {base}/{product}{route}?query and returns the raw JSON body.
// On HTTP 402 without a signer (or if payment fails) it returns
// *PaymentRequiredError; other non-2xx statuses return *APIError.
func (c *Client) Get(ctx context.Context, product, route string, params map[string]string) (json.RawMessage, error) {
	u, err := c.BuildURL(product, route, params)
	if err != nil {
		return nil, err
	}
	return c.do(ctx, u)
}

// Sample fetches the free preview (sample=1, at most 3 rows) of a route.
// No payment is required.
func (c *Client) Sample(ctx context.Context, product, route string, params map[string]string) (json.RawMessage, error) {
	p := Params{}
	for k, v := range params {
		p[k] = v
	}
	p["sample"] = "1"
	return c.Get(ctx, product, route, p)
}

// GetInto is like Get but decodes the JSON body into out.
func (c *Client) GetInto(ctx context.Context, product, route string, params map[string]string, out any) error {
	raw, err := c.Get(ctx, product, route, params)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, out)
}

// Discovery endpoints (free).

// Index fetches GET /.
func (c *Client) Index(ctx context.Context) (json.RawMessage, error) { return c.Get(ctx, "", "/", nil) }

// OpenAPI fetches GET /openapi.json.
func (c *Client) OpenAPI(ctx context.Context) (json.RawMessage, error) {
	return c.Get(ctx, "openapi.json", "", nil)
}

// WellKnownX402 fetches GET /.well-known/x402.
func (c *Client) WellKnownX402(ctx context.Context) (json.RawMessage, error) {
	return c.Get(ctx, ".well-known/x402", "", nil)
}

// Health fetches GET /health.
func (c *Client) Health(ctx context.Context) (json.RawMessage, error) {
	return c.Get(ctx, "health", "", nil)
}

// Meta fetches GET /meta.
func (c *Client) Meta(ctx context.Context) (json.RawMessage, error) {
	return c.Get(ctx, "meta", "", nil)
}

// LLMsTxt fetches GET /llms.txt as text.
func (c *Client) LLMsTxt(ctx context.Context) (string, error) {
	u, _ := c.BuildURL("llms.txt", "", nil)
	b, err := c.do(ctx, u)
	return string(b), err
}

func (c *Client) newRequest(ctx context.Context, u string) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	for k, vs := range c.headers {
		for _, v := range vs {
			req.Header.Add(k, v)
		}
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", c.userAgent)
	if c.rapidKey != "" {
		req.Header.Set("x-rapidapi-key", c.rapidKey)
	}
	if c.rapidHost != "" {
		req.Header.Set("x-rapidapi-host", c.rapidHost)
	}
	return req, nil
}

func (c *Client) send(req *http.Request) (*http.Response, []byte, error) {
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return resp, nil, err
	}
	return resp, body, nil
}

func (c *Client) do(ctx context.Context, u string) (json.RawMessage, error) {
	req, err := c.newRequest(ctx, u)
	if err != nil {
		return nil, err
	}
	resp, body, err := c.send(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusPaymentRequired {
		perr := parsePaymentRequired(u, resp, body)
		if c.signer == nil {
			return nil, perr
		}
		payload, serr := c.signer(ctx, perr.Requirements)
		if serr != nil {
			return nil, fmt.Errorf("lilambd: payment signer: %w", serr)
		}
		req2, err := c.newRequest(ctx, u)
		if err != nil {
			return nil, err
		}
		req2.Header.Set(c.paymentHeader, payload)
		resp, body, err = c.send(req2)
		if err != nil {
			return nil, err
		}
		if resp.StatusCode == http.StatusPaymentRequired {
			perr = parsePaymentRequired(u, resp, body)
			perr.Retried = true
			return nil, perr
		}
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, &APIError{StatusCode: resp.StatusCode, URL: u, Body: body}
	}
	return json.RawMessage(body), nil
}

// APIError is returned for non-2xx responses other than 402.
type APIError struct {
	StatusCode int
	URL        string
	Body       []byte
}

func (e *APIError) Error() string {
	b := string(e.Body)
	if len(b) > 300 {
		b = b[:300] + "..."
	}
	return fmt.Sprintf("lilambd: HTTP %d from %s: %s", e.StatusCode, e.URL, b)
}

// IsPaymentRequired reports whether err is (or wraps) a *PaymentRequiredError.
func IsPaymentRequired(err error) bool {
	var p *PaymentRequiredError
	return errors.As(err, &p)
}
