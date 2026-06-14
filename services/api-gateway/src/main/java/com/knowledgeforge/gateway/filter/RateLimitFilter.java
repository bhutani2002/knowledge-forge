package com.knowledgeforge.gateway.filter;

import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.data.domain.Range;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.time.Instant;
import java.util.UUID;

@Component
public class RateLimitFilter implements GlobalFilter, Ordered {

    private final ReactiveStringRedisTemplate redisTemplate;
    
    // Window configuration (e.g. max 100 requests per minute)
    private static final int WINDOW_SIZE_SECONDS = 60;
    private static final int MAX_REQUESTS = 100;

    public RateLimitFilter(ReactiveStringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        ServerHttpRequest request = exchange.getRequest();
        String ip = request.getRemoteAddress() != null 
                ? request.getRemoteAddress().getAddress().getHostAddress() 
                : "unknown-ip";
                
        String key = "ratelimit:" + ip;
        long now = Instant.now().getEpochSecond();
        long windowStart = now - WINDOW_SIZE_SECONDS;
        String memberId = UUID.randomUUID().toString();

        return redisTemplate.opsForZSet().removeRangeByScore(key, Range.closed(0.0, (double) windowStart))
                .flatMap(removed -> redisTemplate.opsForZSet().add(key, memberId, now))
                .flatMap(added -> redisTemplate.opsForZSet().size(key))
                .flatMap(count -> redisTemplate.expire(key, java.time.Duration.ofSeconds(WINDOW_SIZE_SECONDS))
                        .then(Mono.just(count)))
                .flatMap(count -> {
                    if (count > MAX_REQUESTS) {
                        exchange.getResponse().setStatusCode(HttpStatus.TOO_MANY_REQUESTS);
                        return exchange.getResponse().setComplete();
                    }
                    return chain.filter(exchange);
                });
    }

    @Override
    public int getOrder() {
        // Run after Correlation ID filter but before routing
        return -10;
    }
}
