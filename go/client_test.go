package lilambd

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
)

type recorder struct {
	mu   sync.Mutex
	reqs []*http.Request
}

func (r *recorder) last() *http.Request {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.reqs[len(r.reqs)-1]
}

func newServer(t *testing.T, h http.HandlerFunc) (*httptest.Server, *recorder) {
	t.Helper()
	rec := &recorder{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		rec.mu.Lock()
		rec.reqs = append(rec.reqs, req.Clone(context.Background()))
		rec.mu.Unlock()
		if h != nil {
			h(w, req)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(srv.Close)
	return srv, rec
}

const challengeJSON = `{"x402Version":2,"error":"payment required","resource":{"url":"https://api.lilambd.com/airports/search","mimeType":"application/json"},"accepts":[{"scheme":"exact","network":"eip155:8453","amount":"5000","asset":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","payTo":"0x0000000000000000000000000000000000000001","maxTimeoutSeconds":60,"extra":{"name":"USD Coin","version":"2"}}]}`

func payHandler(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get(HeaderPaymentSignature) == "" && r.Header.Get(HeaderXPayment) == "" && r.URL.Query().Get("sample") != "1" {
		w.Header().Set(HeaderPaymentRequired, base64.StdEncoding.EncodeToString([]byte(challengeJSON)))
		w.WriteHeader(http.StatusPaymentRequired)
		w.Write([]byte(challengeJSON))
		return
	}
	w.Write([]byte(`{"rows":[1,2,3]}`))
}

func TestBuildURL(t *testing.T) {
	c := New(WithBaseURL("https://example.test/"))
	cases := []struct {
		product, route string
		params         Params
		want           string
	}{
		{"airports", "/search", Params{"q": "tokyo", "limit": "5"}, "https://example.test/airports/search?limit=5&q=tokyo"},
		{"airports", "/{code}", Params{"code": "HND"}, "https://example.test/airports/HND"},
		{"hazard", "/regions/{id}/events", Params{"id": "a b/c", "days": "7"}, "https://example.test/hazard/regions/a%20b%2Fc/events?days=7"},
		{"", "/", nil, "https://example.test/"},
		{"openapi.json", "", nil, "https://example.test/openapi.json"},
		{".well-known/x402", "", nil, "https://example.test/.well-known/x402"},
	}
	for _, tc := range cases {
		got, err := c.BuildURL(tc.product, tc.route, tc.params)
		if err != nil {
			t.Fatalf("%v: %v", tc, err)
		}
		if got != tc.want {
			t.Errorf("BuildURL(%q,%q)=%q want %q", tc.product, tc.route, got, tc.want)
		}
	}
	if _, err := c.BuildURL("airports", "/{code}", nil); err == nil {
		t.Error("expected missing placeholder error")
	}
	if New().BaseURL() != DefaultBaseURL {
		t.Error("default base URL")
	}
}

func TestGetAndPlaceholders(t *testing.T) {
	srv, rec := newServer(t, nil)
	c := New(WithBaseURL(srv.URL))
	raw, err := c.Airports().GetByCode(context.Background(), "HND", Params{"fields": "name"})
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != `{"ok":true}` {
		t.Fatalf("body %s", raw)
	}
	r := rec.last()
	if r.URL.Path != "/airports/HND" || r.URL.Query().Get("fields") != "name" || r.URL.Query().Has("code") {
		t.Fatalf("unexpected request %s", r.URL)
	}
	if !strings.HasPrefix(r.Header.Get("User-Agent"), "lilambd-go/") {
		t.Error("user agent")
	}
	if _, err := c.Get(context.Background(), "airports", "/search", map[string]string{"q": "tokyo"}); err != nil {
		t.Fatal(err)
	}
	if got := rec.last().URL.RequestURI(); got != "/airports/search?q=tokyo" {
		t.Errorf("got %s", got)
	}
}

func TestPaymentRequiredParse(t *testing.T) {
	srv, _ := newServer(t, payHandler)
	c := New(WithBaseURL(srv.URL))
	_, err := c.Airports().Search(context.Background(), Params{"q": "tokyo"})
	var perr *PaymentRequiredError
	if !errors.As(err, &perr) || !IsPaymentRequired(err) {
		t.Fatalf("want PaymentRequiredError, got %v", err)
	}
	req := perr.Requirements
	if req.X402Version != 2 || len(req.Accepts) != 1 || req.Accepts[0].Network != "eip155:8453" || req.Accepts[0].AmountAtomic() != "5000" {
		t.Fatalf("bad requirements %+v", req)
	}
	if math.Abs(perr.PriceUSD()-0.005) > 1e-12 {
		t.Errorf("price %v", perr.PriceUSD())
	}
	if !strings.Contains(err.Error(), "402") {
		t.Error(err.Error())
	}
	// body-only fallback
	srv2, _ := newServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(402)
		w.Write([]byte(`{"x402Version":1,"accepts":[{"scheme":"exact","network":"base","maxAmountRequired":"500000"}]}`))
	})
	_, err = New(WithBaseURL(srv2.URL)).Get(context.Background(), "exposure", "/brief", nil)
	if !errors.As(err, &perr) || perr.PriceUSD() != 0.5 {
		t.Fatalf("fallback parse: %v", err)
	}
}

func TestSignerRetry(t *testing.T) {
	srv, rec := newServer(t, payHandler)
	var got *PaymentRequirements
	c := New(WithBaseURL(srv.URL), WithPaymentSigner(func(ctx context.Context, r *PaymentRequirements) (string, error) {
		got = r
		return "signed-payload", nil
	}))
	raw, err := c.Airports().Search(context.Background(), Params{"q": "tokyo"})
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != `{"rows":[1,2,3]}` || got == nil || got.PriceUSD() != 0.005 {
		t.Fatalf("raw=%s got=%v", raw, got)
	}
	if len(rec.reqs) != 2 || rec.last().Header.Get(HeaderPaymentSignature) != "signed-payload" {
		t.Fatalf("retry header missing; %d requests", len(rec.reqs))
	}
	// alternate header
	c2 := New(WithBaseURL(srv.URL), WithPaymentHeader(HeaderXPayment), WithPaymentSigner(func(context.Context, *PaymentRequirements) (string, error) { return "x", nil }))
	if _, err := c2.Airports().Search(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	if rec.last().Header.Get(HeaderXPayment) != "x" {
		t.Error("X-PAYMENT not sent")
	}
	// signer error propagates
	c3 := New(WithBaseURL(srv.URL), WithPaymentSigner(func(context.Context, *PaymentRequirements) (string, error) { return "", errors.New("no funds") }))
	if _, err := c3.Airports().Search(context.Background(), nil); err == nil || !strings.Contains(err.Error(), "no funds") {
		t.Fatalf("signer error: %v", err)
	}
	// rejected payment
	srvBad, _ := newServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set(HeaderPaymentRequired, base64.StdEncoding.EncodeToString([]byte(challengeJSON)))
		w.WriteHeader(402)
	})
	c4 := New(WithBaseURL(srvBad.URL), WithPaymentSigner(func(context.Context, *PaymentRequirements) (string, error) { return "bad", nil }))
	_, err = c4.Airports().Search(context.Background(), nil)
	var perr *PaymentRequiredError
	if !errors.As(err, &perr) || !perr.Retried {
		t.Fatalf("want retried 402, got %v", err)
	}
}

func TestSample(t *testing.T) {
	srv, rec := newServer(t, payHandler)
	c := New(WithBaseURL(srv.URL))
	params := Params{"q": "tokyo"}
	if _, err := c.Sample(context.Background(), "airports", "/search", params); err != nil {
		t.Fatal(err)
	}
	if q := rec.last().URL.Query(); q.Get("sample") != "1" || q.Get("q") != "tokyo" {
		t.Fatalf("query %v", q)
	}
	if _, ok := params["sample"]; ok {
		t.Error("Sample mutated caller params")
	}
	if _, err := c.Hazard().Sample(context.Background(), "/regions/{id}", Params{"id": "R1"}); err != nil {
		t.Fatal(err)
	}
	if rec.last().URL.Path != "/hazard/regions/R1" {
		t.Error(rec.last().URL.Path)
	}
}

func TestRapidAPIHeaders(t *testing.T) {
	srv, rec := newServer(t, nil)
	c := New(WithRapidAPI("k123", "lilambd.p.rapidapi.com"), WithBaseURL(srv.URL))
	if _, err := c.Units().Convert(context.Background(), Params{"from": "m", "to": "ft", "value": "1"}); err != nil {
		t.Fatal(err)
	}
	r := rec.last()
	if r.Header.Get("x-rapidapi-key") != "k123" || r.Header.Get("x-rapidapi-host") != "lilambd.p.rapidapi.com" {
		t.Fatalf("headers %v", r.Header)
	}
	if New(WithRapidAPI("k", "h.example")).BaseURL() != "https://h.example" {
		t.Error("rapid default base URL")
	}
}

func TestAPIError(t *testing.T) {
	srv, _ := newServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(404)
		w.Write([]byte(`{"error":"not found"}`))
	})
	_, err := New(WithBaseURL(srv.URL)).Airports().GetByCode(context.Background(), "ZZZ", nil)
	var aerr *APIError
	if !errors.As(err, &aerr) || aerr.StatusCode != 404 {
		t.Fatalf("got %v", err)
	}
}

func TestDiscovery(t *testing.T) {
	srv, rec := newServer(t, nil)
	c := New(WithBaseURL(srv.URL))
	ctx := context.Background()
	for path, f := range map[string]func(context.Context) (json.RawMessage, error){
		"/": c.Index, "/openapi.json": c.OpenAPI, "/.well-known/x402": c.WellKnownX402, "/health": c.Health, "/meta": c.Meta,
	} {
		if _, err := f(ctx); err != nil {
			t.Fatal(err)
		}
		if rec.last().URL.Path != path {
			t.Errorf("want %s got %s", path, rec.last().URL.Path)
		}
	}
	if _, err := c.LLMsTxt(ctx); err != nil || rec.last().URL.Path != "/llms.txt" {
		t.Error("llms.txt")
	}
}

func TestCatalogEmbedded(t *testing.T) {
	ps := Products()
	if len(ps) != 27 {
		t.Fatalf("products=%d", len(ps))
	}
	n := 0
	for _, p := range ps {
		n += len(p.Routes)
	}
	if n != 170 {
		t.Fatalf("routes=%d", n)
	}
	p, ok := FindProduct("koyomi")
	if !ok || !p.IsFree("/helplines") || p.PriceUSD() != 0.05 {
		t.Fatalf("koyomi %+v", p.FreeRoutes)
	}
}

// TestGeneratedMethodsCoverCatalog calls every generated method via reflection
// and checks it hits exactly the catalog route it claims.
func TestGeneratedMethodsCoverCatalog(t *testing.T) {
	srv, rec := newServer(t, nil)
	c := New(WithBaseURL(srv.URL))
	cv := reflect.ValueOf(c)

	want := map[string]bool{}
	for _, p := range Products() {
		for _, r := range p.Routes {
			want[p.ID+" "+r.Path] = true
		}
	}
	if len(GeneratedRoutes) != len(want) {
		t.Fatalf("generated %d methods, catalog has %d routes", len(GeneratedRoutes), len(want))
	}
	ctxT := reflect.TypeOf((*context.Context)(nil)).Elem()
	for _, g := range GeneratedRoutes {
		key := g.Product + " " + g.Path
		if !want[key] {
			t.Errorf("%s maps to unknown route %s", g.Method, key)
			continue
		}
		delete(want, key)
		typ, meth, _ := strings.Cut(g.Method, ".")
		acc := cv.MethodByName(strings.TrimSuffix(typ, "API"))
		if !acc.IsValid() {
			t.Errorf("no accessor for %s", typ)
			continue
		}
		api := acc.Call(nil)[0]
		m := api.MethodByName(meth)
		if !m.IsValid() {
			t.Errorf("missing method %s", g.Method)
			continue
		}
		mt := m.Type()
		args := []reflect.Value{reflect.ValueOf(context.Background())}
		if mt.In(0) != ctxT {
			t.Fatalf("%s first arg not context", g.Method)
		}
		expected := g.Path
		for i := 1; i < mt.NumIn()-1; i++ {
			v := "v" + string(rune('0'+i))
			args = append(args, reflect.ValueOf(v))
			start := strings.Index(expected, "{")
			end := strings.Index(expected, "}")
			expected = expected[:start] + v + expected[end+1:]
		}
		if strings.Contains(expected, "{") {
			t.Errorf("%s: not all placeholders are arguments", g.Method)
			continue
		}
		args = append(args, reflect.ValueOf(Params{"probe": "1"}))
		out := m.Call(args)
		if err, _ := out[1].Interface().(error); err != nil {
			t.Errorf("%s: %v", g.Method, err)
			continue
		}
		r := rec.last()
		if r.URL.Path != "/"+g.Product+expected || r.URL.Query().Get("probe") != "1" {
			t.Errorf("%s hit %s, want /%s%s", g.Method, r.URL, g.Product, expected)
		}
	}
	for k := range want {
		t.Errorf("catalog route without method: %s", k)
	}
}
