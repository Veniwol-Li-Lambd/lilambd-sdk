package lilambd

import (
	_ "embed"
	"encoding/json"
	"sync"
)

//go:embed catalog.json
var catalogJSON []byte

// Catalog is the embedded API catalog (a copy of spec/catalog.json).
type Catalog struct {
	Service     string    `json:"service"`
	BaseURL     string    `json:"base_url"`
	MCPURL      string    `json:"mcp_url"`
	FreeSample  string    `json:"free_sample"`
	CatalogAsOf string    `json:"catalog_as_of"`
	Products    []Product `json:"products"`
}

// Product is one dataset/API product.
type Product struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	PriceAtomic string   `json:"price_atomic"`
	FreeRoutes  []string `json:"free_routes"`
	Routes      []Route  `json:"routes"`
}

// PriceUSD returns the per-call price in USD.
func (p Product) PriceUSD() float64 { return AtomicToUSD(p.PriceAtomic) }

// IsFree reports whether route is served without payment.
func (p Product) IsFree(route string) bool {
	for _, r := range p.FreeRoutes {
		if r == route {
			return true
		}
	}
	return false
}

// Route is one GET route of a product.
type Route struct {
	Path        string  `json:"path"`
	Summary     string  `json:"summary"`
	OperationID string  `json:"operationId"`
	Params      []Param `json:"params"`
}

// Param describes a route parameter.
type Param struct {
	Name        string `json:"name"`
	In          string `json:"in"`
	Required    bool   `json:"required"`
	Type        string `json:"type"`
	Description string `json:"description"`
	Example     any    `json:"example"`
}

var (
	catalogOnce sync.Once
	catalogVal  *Catalog
	catalogErr  error
)

// LoadCatalog returns the embedded catalog.
func LoadCatalog() (*Catalog, error) {
	catalogOnce.Do(func() {
		var c Catalog
		catalogErr = json.Unmarshal(catalogJSON, &c)
		catalogVal = &c
	})
	return catalogVal, catalogErr
}

// Products lists all products in the embedded catalog.
func Products() []Product {
	c, err := LoadCatalog()
	if err != nil {
		return nil
	}
	return c.Products
}

// FindProduct returns a product by id.
func FindProduct(id string) (Product, bool) {
	for _, p := range Products() {
		if p.ID == id {
			return p, true
		}
	}
	return Product{}, false
}
