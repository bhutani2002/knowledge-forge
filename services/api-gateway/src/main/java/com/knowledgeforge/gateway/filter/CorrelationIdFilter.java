package com.knowledgeforge.gateway.filter;

import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.util.UUID;

@Component
public class CorrelationIdFilter implements GlobalFilter, Ordered {

    public static final String CORRELATION_ID_HEADER = "X-Correlation-ID";
    public static final String SPAN_ID_HEADER = "X-Span-ID";

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        ServerHttpRequest request = exchange.getRequest();
        String correlationId = request.getHeaders().getFirst(CORRELATION_ID_HEADER);
        String spanId = request.getHeaders().getFirst(SPAN_ID_HEADER);

        boolean mutateRequest = false;
        ServerHttpRequest.Builder requestBuilder = request.mutate();

        if (correlationId == null || correlationId.trim().isEmpty()) {
            correlationId = UUID.randomUUID().toString();
            requestBuilder.header(CORRELATION_ID_HEADER, correlationId);
            mutateRequest = true;
        }

        // Generate a new span ID for gateway processing step
        if (spanId == null || spanId.trim().isEmpty()) {
            spanId = UUID.randomUUID().toString().substring(0, 16);
            requestBuilder.header(SPAN_ID_HEADER, spanId);
            mutateRequest = true;
        }

        if (mutateRequest) {
            exchange = exchange.mutate().request(requestBuilder.build()).build();
        }

        // Set correlation and span in response headers
        exchange.getResponse().getHeaders().add(CORRELATION_ID_HEADER, correlationId);
        exchange.getResponse().getHeaders().add(SPAN_ID_HEADER, spanId);

        return chain.filter(exchange);
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE;
    }
}
