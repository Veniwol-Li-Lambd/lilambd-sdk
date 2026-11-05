// Command payment shows the x402 payment hook and RapidAPI mode.
//
// Plug a real x402 signer (an EIP-3009 transferWithAuthorization signed by
// your wallet, base64-encoded as an x402 v2 PaymentPayload) into signPayment.
// Set LILAMBD_X402_PAYLOAD to a pre-built payload, or RAPIDAPI_KEY and
// RAPIDAPI_HOST to use RapidAPI billing instead.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"time"

	lilambd "github.com/Veniwol-Li-Lambd/lilambd-sdk/go"
)

func signPayment(ctx context.Context, req *lilambd.PaymentRequirements) (string, error) {
	opt := req.Accepts[0]
	fmt.Printf("server asks %s atomic (%s) on %s, payTo %s ($%.4f)\n",
		opt.AmountAtomic(), opt.Asset, opt.Network, opt.PayTo, req.PriceUSD())
	if req.PriceUSD() > 0.10 {
		return "", errors.New("price above my budget")
	}
	p := os.Getenv("LILAMBD_X402_PAYLOAD")
	if p == "" {
		return "", errors.New("set LILAMBD_X402_PAYLOAD or implement an x402 signer")
	}
	return p, nil
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var c *lilambd.Client
	if key := os.Getenv("RAPIDAPI_KEY"); key != "" {
		c = lilambd.New(lilambd.WithRapidAPI(key, os.Getenv("RAPIDAPI_HOST")))
	} else {
		c = lilambd.New(lilambd.WithPaymentSigner(signPayment))
	}

	raw, err := c.Units().Convert(ctx, lilambd.Params{"from": "mi", "to": "km", "value": "26.2"})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(string(raw))
}
