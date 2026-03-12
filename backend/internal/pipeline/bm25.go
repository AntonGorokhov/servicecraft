package pipeline

import (
	"math"
	"regexp"
	"strings"
)

var ruStopwords = map[string]bool{
	"и": true, "в": true, "не": true, "на": true, "я": true, "что": true,
	"тот": true, "с": true, "а": true, "это": true, "как": true, "она": true,
	"по": true, "но": true, "они": true, "к": true, "у": true, "ты": true,
	"из": true, "мы": true, "за": true, "вы": true, "так": true, "же": true,
	"от": true, "он": true, "о": true, "один": true, "бы": true, "только": true,
	"себя": true, "какой": true, "уже": true, "для": true, "вот": true, "да": true,
	"до": true, "или": true, "если": true, "нет": true, "ни": true, "даже": true,
	"свой": true, "ну": true, "под": true, "где": true, "есть": true, "раз": true,
	"чтобы": true, "там": true, "чем": true, "без": true, "то": true, "со": true,
	"при": true, "об": true, "во": true, "про": true, "над": true, "через": true,
	"между": true, "перед": true, "после": true, "также": true, "ли": true,
	"всё": true, "все": true, "был": true, "была": true, "были": true, "быть": true,
	"этот": true, "эта": true, "эти": true, "который": true, "которая": true, "которые": true,
}

var tokenRe = regexp.MustCompile(`[а-яёa-z0-9]+`)

// SparseVector is a Qdrant-compatible sparse vector.
type SparseVector struct {
	Indices []uint32  `json:"indices"`
	Values  []float32 `json:"values"`
}

// BM25Encoder encodes text as sparse BM25 vectors over a fixed vocabulary.
type BM25Encoder struct {
	vocab  map[string]uint32
	idf    []float64
	avgdl  float64
	k1     float64
	b      float64
}

func tokenize(text string) []string {
	raw := tokenRe.FindAllString(strings.ToLower(text), -1)
	out := raw[:0]
	for _, t := range raw {
		if len(t) > 1 && !ruStopwords[t] {
			out = append(out, t)
		}
	}
	return out
}

// NewBM25Encoder builds an encoder from a text corpus (e.g. all question+answer strings).
func NewBM25Encoder(corpus []string) *BM25Encoder {
	enc := &BM25Encoder{
		vocab: make(map[string]uint32),
		k1:    1.2,
		b:     0.75,
	}

	df := make(map[string]int)
	totalLen := 0

	for _, doc := range corpus {
		tokens := tokenize(doc)
		totalLen += len(tokens)
		seen := make(map[string]bool)
		for _, t := range tokens {
			if _, exists := enc.vocab[t]; !exists {
				enc.vocab[t] = uint32(len(enc.vocab))
			}
			if !seen[t] {
				df[t]++
				seen[t] = true
			}
		}
	}

	N := len(corpus)
	if N == 0 || totalLen == 0 {
		return enc
	}
	enc.avgdl = float64(totalLen) / float64(N)

	enc.idf = make([]float64, len(enc.vocab))
	for term, idx := range enc.vocab {
		d := df[term]
		// Robertson-Sparck Jones smoothed IDF
		enc.idf[idx] = math.Log(float64(N-d+1)/float64(d+1) + 1)
	}

	return enc
}

// VocabSize returns the number of unique terms in the vocabulary.
func (e *BM25Encoder) VocabSize() int {
	return len(e.vocab)
}

// Encode converts text into a sparse BM25 vector over the learned vocabulary.
func (e *BM25Encoder) Encode(text string) SparseVector {
	if len(e.vocab) == 0 || e.avgdl == 0 {
		return SparseVector{}
	}

	tokens := tokenize(text)
	if len(tokens) == 0 {
		return SparseVector{}
	}

	tf := make(map[uint32]int)
	for _, t := range tokens {
		if idx, ok := e.vocab[t]; ok {
			tf[idx]++
		}
	}

	dl := float64(len(tokens))
	indices := make([]uint32, 0, len(tf))
	values := make([]float32, 0, len(tf))

	for idx, count := range tf {
		if int(idx) >= len(e.idf) {
			continue
		}
		idfVal := e.idf[idx]
		tfd := float64(count)
		tfScore := tfd * (e.k1 + 1) / (tfd + e.k1*(1-e.b+e.b*dl/e.avgdl))
		score := float32(idfVal * tfScore)
		if score > 0 {
			indices = append(indices, idx)
			values = append(values, score)
		}
	}

	return SparseVector{Indices: indices, Values: values}
}
