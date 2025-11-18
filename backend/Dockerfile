FROM golang:1.24-alpine AS builder

WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o vetkb-api ./cmd/api

FROM alpine:3.21
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /build/vetkb-api .
COPY --from=builder /build/price-tree.yaml .
EXPOSE 8080
CMD ["./vetkb-api"]
