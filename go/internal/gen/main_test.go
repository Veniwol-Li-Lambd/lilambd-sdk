package main

import "testing"

func TestMethodName(t *testing.T) {
	for in, want := range map[string]string{
		"/search": "Search", "/{code}": "GetByCode", "/mcp/daily": "MCPDaily", "/mcp/{name}": "MCPByName",
		"/regions/{id}/events": "RegionsByIDEvents", "/": "Index", "/x402/price-check": "X402PriceCheck",
		"/{name_or_hex}": "GetByNameOrHex",
	} {
		if got := MethodName(in); got != want {
			t.Errorf("MethodName(%q)=%q want %q", in, got, want)
		}
	}
	if camel("city_code") != "cityCode" || camel("iso2") != "iso2" || camel("type") != "typeArg" {
		t.Error(camel("city_code"), camel("iso2"))
	}
}
