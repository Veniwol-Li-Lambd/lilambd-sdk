package lilambd

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"strings"
)

// USDCDecimals is the number of decimals of USDC atomic amounts.
const USDCDecimals = 6

// PaymentRequirements is the decoded x402 challenge (PAYMENT-REQUIRED header,
// falling back to the 402 JSON body).
type PaymentRequirements struct {
	X402Version int             `json:"x402Version"`
	Error       string          `json:"error,omitempty"`
	Resource    *Resource       `json:"resource,omitempty"`
	Accepts     []PaymentOption `json:"accepts"`
	Extensions  json.RawMessage `json:"extensions,omitempty"`
	// Raw is the original base64 header value (or JSON body if no header).
	Raw string `json:"-"`
}

// Resource describes the paid resource.
type Resource struct {
	URL         string `json:"url"`
	Description string `json:"description,omitempty"`
	MimeType    string `json:"mimeType,omitempty"`
}

// PaymentOption is one accepted payment method.
type PaymentOption struct {
	Scheme            string          `json:"scheme"`
	Network           string          `json:"network"`
	Amount            string          `json:"amount,omitempty"`
	MaxAmountRequired string          `json:"maxAmountRequired,omitempty"` // x402 v1
	Asset             string          `json:"asset"`
	PayTo             string          `json:"payTo"`
	MaxTimeoutSeconds int             `json:"maxTimeoutSeconds,omitempty"`
	Resource          string          `json:"resource,omitempty"` // x402 v1
	Description       string          `json:"description,omitempty"`
	Extra             json.RawMessage `json:"extra,omitempty"`
}

// AmountAtomic returns the amount in atomic units (v2 amount or v1 maxAmountRequired).
func (o PaymentOption) AmountAtomic() string {
	if o.Amount != "" {
		return o.Amount
	}
	return o.MaxAmountRequired
}

// PriceUSD returns the first option's amount in USD (USDC, 6 decimals).
func (r *PaymentRequirements) PriceUSD() float64 {
	if r == nil || len(r.Accepts) == 0 {
		return 0
	}
	return AtomicToUSD(r.Accepts[0].AmountAtomic())
}

// AtomicToUSD converts a USDC atomic amount string ("5000") to dollars (0.005).
func AtomicToUSD(atomic string) float64 {
	n, ok := new(big.Int).SetString(strings.TrimSpace(atomic), 10)
	if !ok {
		return 0
	}
	f, _ := new(big.Rat).SetFrac(n, big.NewInt(1_000_000)).Float64()
	return f
}

// PaymentRequiredError is returned when the API answers HTTP 402.
type PaymentRequiredError struct {
	URL          string
	Requirements *PaymentRequirements
	Body         []byte
	// Retried is true if a signed payment was sent and still rejected.
	Retried bool
}

func (e *PaymentRequiredError) Error() string {
	msg := fmt.Sprintf("lilambd: payment required (HTTP 402) for %s: $%.6g USDC", e.URL, e.PriceUSD())
	if e.Retried {
		msg += " (payment rejected)"
	}
	if e.Requirements != nil && e.Requirements.Error != "" {
		msg += ": " + e.Requirements.Error
	}
	return msg + "; add sample=1 for a free preview or configure WithPaymentSigner"
}

// PriceUSD returns the price of the call in USD.
func (e *PaymentRequiredError) PriceUSD() float64 { return e.Requirements.PriceUSD() }

// DecodePaymentRequired decodes a base64 (std or URL alphabet) PAYMENT-REQUIRED header.
func DecodePaymentRequired(header string) (*PaymentRequirements, error) {
	header = strings.TrimSpace(header)
	var data []byte
	var err error
	for _, enc := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
		if data, err = enc.DecodeString(header); err == nil {
			break
		}
	}
	if err != nil {
		return nil, fmt.Errorf("lilambd: decode %s: %w", HeaderPaymentRequired, err)
	}
	var r PaymentRequirements
	if err := json.Unmarshal(data, &r); err != nil {
		return nil, fmt.Errorf("lilambd: parse %s: %w", HeaderPaymentRequired, err)
	}
	r.Raw = header
	return &r, nil
}

func parsePaymentRequired(u string, resp *http.Response, body []byte) *PaymentRequiredError {
	e := &PaymentRequiredError{URL: u, Body: body}
	if h := resp.Header.Get(HeaderPaymentRequired); h != "" {
		if r, err := DecodePaymentRequired(h); err == nil {
			e.Requirements = r
		}
	}
	if e.Requirements == nil {
		var r PaymentRequirements
		if json.Unmarshal(body, &r) == nil {
			r.Raw = string(body)
			e.Requirements = &r
		} else {
			e.Requirements = &PaymentRequirements{Raw: string(body)}
		}
	}
	return e
}
