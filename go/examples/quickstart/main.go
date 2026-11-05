// Command quickstart lists products and fetches free samples (no wallet needed).
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	lilambd "github.com/Veniwol-Li-Lambd/lilambd-sdk/go"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	for _, p := range lilambd.Products() {
		fmt.Printf("%-14s $%.3f/call  %d routes  %s\n", p.ID, p.PriceUSD(), len(p.Routes), p.Title)
	}

	c := lilambd.New()

	// Free 3-row preview of a paid route.
	raw, err := c.Airports().Search(ctx, lilambd.Params{"q": "tokyo", "sample": "1"})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("sample:", string(raw))

	// Same thing through the generic helper.
	raw, err = c.Sample(ctx, "airports", "/{code}", lilambd.Params{"code": "HND"})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("sample:", string(raw))

	// A paid call without a signer returns *PaymentRequiredError with the price.
	_, err = c.Airports().GetByCode(ctx, "HND", nil)
	var perr *lilambd.PaymentRequiredError
	if errors.As(err, &perr) {
		fmt.Printf("full call costs $%.4f USDC on %s\n", perr.PriceUSD(), perr.Requirements.Accepts[0].Network)
	} else if err != nil {
		log.Fatal(err)
	}
}
