package services

import (
	"os"
	"regexp"
	"strings"
	"unicode"

	"gopkg.in/yaml.v3"
)

// PriceVariant represents a conditional price variant.
type PriceVariant struct {
	Condition string `json:"condition" yaml:"condition"`
	Price     int    `json:"price" yaml:"price"`
}

// PriceEntry is a service or group node in the price tree.
type PriceEntry struct {
	Service  string         `json:"service,omitempty" yaml:"service"`
	Price    int            `json:"price,omitempty" yaml:"price"`
	Group    string         `json:"group,omitempty" yaml:"group"`
	Services []PriceEntry   `json:"services,omitempty" yaml:"services"`
	Variants []PriceVariant `json:"variants,omitempty" yaml:"variants"`
}

// PriceCategory is a top-level category in the price tree.
type PriceCategory struct {
	Category string       `json:"category" yaml:"category"`
	Services []PriceEntry `json:"services" yaml:"services"`
}

// flatEntry is a flattened service for fast lookup.
type flatEntry struct {
	Name     string
	Price    int
	Category string
	TreePath string
	Tokens   []string
}

// PriceMatch is the result of a service name match.
type PriceMatch struct {
	Name     string `json:"name"`
	Price    int    `json:"price"`
	Category string `json:"category"`
	TreePath string `json:"tree_path"`
}

// PriceService provides access to the price tree and service matching.
type PriceService struct {
	tree  []PriceCategory
	index []flatEntry
}

// LoadPriceTree parses the YAML file into a slice of PriceCategory.
func LoadPriceTree(path string) ([]PriceCategory, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var tree []PriceCategory
	if err := yaml.Unmarshal(data, &tree); err != nil {
		return nil, err
	}
	return tree, nil
}

// NewPriceService creates a PriceService with a pre-built flat index.
func NewPriceService(tree []PriceCategory) *PriceService {
	ps := &PriceService{tree: tree}
	ps.buildIndex()
	return ps
}

// GetTree returns the full price tree.
func (ps *PriceService) GetTree() []PriceCategory {
	return ps.tree
}

// buildIndex flattens the tree into a slice for fast matching.
func (ps *PriceService) buildIndex() {
	for _, cat := range ps.tree {
		catSlug := slugify(cat.Category)
		ps.flattenEntries(cat.Services, cat.Category, catSlug)
	}
}

func (ps *PriceService) flattenEntries(entries []PriceEntry, category, pathPrefix string) {
	for _, e := range entries {
		if e.Group != "" {
			// Recurse into group
			groupSlug := pathPrefix + "--" + slugify(e.Group)
			ps.flattenEntries(e.Services, category, groupSlug)
		} else if e.Service != "" {
			svcSlug := pathPrefix + "--" + slugify(e.Service)
			price := e.Price
			if price == 0 && len(e.Variants) > 0 {
				price = e.Variants[0].Price // use first variant price as default
			}
			ps.index = append(ps.index, flatEntry{
				Name:     e.Service,
				Price:    price,
				Category: category,
				TreePath: svcSlug,
				Tokens:   tokenize(e.Service),
			})
		}
	}
}

// MatchService finds the best price tree entry matching the query string.
// Returns nil if no match above threshold.
func (ps *PriceService) MatchService(query string) *PriceMatch {
	queryTokens := tokenize(query)
	if len(queryTokens) == 0 {
		return nil
	}

	var bestEntry *flatEntry
	var bestScore float64
	const threshold = 0.45

	for i := range ps.index {
		score := tokenOverlap(queryTokens, ps.index[i].Tokens)
		if score > bestScore {
			bestScore = score
			bestEntry = &ps.index[i]
		}
	}

	if bestEntry == nil || bestScore < threshold {
		return nil
	}

	return &PriceMatch{
		Name:     bestEntry.Name,
		Price:    bestEntry.Price,
		Category: bestEntry.Category,
		TreePath: bestEntry.TreePath,
	}
}

// tokenOverlap computes Jaccard-like overlap between two token sets,
// weighted by the query coverage (what fraction of query tokens matched).
func tokenOverlap(query, target []string) float64 {
	if len(query) == 0 || len(target) == 0 {
		return 0
	}

	targetSet := make(map[string]bool, len(target))
	for _, t := range target {
		targetSet[t] = true
	}

	matched := 0
	for _, q := range query {
		if targetSet[q] {
			matched++
		}
	}

	if matched == 0 {
		return 0
	}

	// Harmonic mean of precision (matched/len(target)) and recall (matched/len(query))
	precision := float64(matched) / float64(len(target))
	recall := float64(matched) / float64(len(query))
	return 2 * precision * recall / (precision + recall)
}

var nonAlphaNum = regexp.MustCompile(`[^\p{L}\p{N}]+`)

// tokenize normalizes and splits a string into tokens.
func tokenize(s string) []string {
	s = strings.ToLower(s)
	s = nonAlphaNum.ReplaceAllString(s, " ")
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	parts := strings.Fields(s)
	// Filter out very short tokens (1-2 char) that add noise
	var tokens []string
	for _, p := range parts {
		if countRunes(p) > 2 {
			tokens = append(tokens, p)
		}
	}
	return tokens
}

func countRunes(s string) int {
	n := 0
	for range s {
		n++
	}
	return n
}

// slugify converts a string to a URL-safe slug.
func slugify(s string) string {
	s = strings.ToLower(s)
	// Remove emoji and non-letter/digit/space chars
	var b strings.Builder
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == ' ' || r == '-' {
			b.WriteRune(r)
		}
	}
	s = strings.TrimSpace(b.String())
	s = regexp.MustCompile(`[\s-]+`).ReplaceAllString(s, "-")
	// Limit length
	if len(s) > 80 {
		s = s[:80]
	}
	return s
}
