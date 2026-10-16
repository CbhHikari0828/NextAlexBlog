FROM golang:1.25-alpine AS builder

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -o /out/blog-api ./cmd/server

FROM alpine:3.22

RUN addgroup -S app && adduser -S app -G app
COPY --from=builder /out/blog-api /usr/local/bin/blog-api

USER app
EXPOSE 8090

CMD ["/usr/local/bin/blog-api"]
