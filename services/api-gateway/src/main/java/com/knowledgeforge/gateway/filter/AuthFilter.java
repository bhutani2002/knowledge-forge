package com.knowledgeforge.gateway.filter;

import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.http.HttpCookie;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;

@Component
public class AuthFilter implements GlobalFilter, Ordered {

    // In production, load this from environment variables
    private static final String JWT_SECRET = "32_bytes_long_random_hex_string_for_security_keys_here";

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        ServerHttpRequest request = exchange.getRequest();
        
        // Skip auth check for public paths
        String path = request.getURI().getPath();
        if (path.startsWith("/api/auth/login") || 
            path.startsWith("/api/auth/register") || 
            path.startsWith("/api/auth/reset") || 
            path.startsWith("/api/auth/google") ||
            path.startsWith("/api/auth/refresh") ||
            path.startsWith("/api/auth/health") ||
            path.startsWith("/actuator/") ||
            !path.startsWith("/api/")) {
            return chain.filter(exchange);
        }

        // 1. Retrieve token from Bearer Header or Cookie
        String token = null;
        String authHeader = request.getHeaders().getFirst("Authorization");
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            token = authHeader.substring(7);
        } else {
            HttpCookie cookie = request.getCookies().getFirst("jwt_token");
            if (cookie != null) {
                token = cookie.getValue();
            }
        }

        if (token == null || token.trim().isEmpty()) {
            // Allow guest mode for query endpoints, documents, but don't inject user headers
            if (path.startsWith("/api/chat/") || path.startsWith("/api/query-stream") || path.startsWith("/api/docs")) {
                String guestHeader = request.getHeaders().getFirst("X-Guest-Id");
                String guestId = (guestHeader != null && !guestHeader.trim().isEmpty()) ? guestHeader : "guest-user-id";
                ServerHttpRequest mutatedRequest = request.mutate()
                        .header("X-User-Role", "GUEST")
                        .header("X-User-Id", guestId)
                        .header("X-User-Tier", "FREE")
                        .build();
                return chain.filter(exchange.mutate().request(mutatedRequest).build());
            }
            exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
            return exchange.getResponse().setComplete();
        }

        try {
            // 2. Simple JWT claim extraction (parsing payload)
            // JWT format: header.payload.signature
            String[] parts = token.split("\\.");
            if (parts.length < 2) {
                throw new IllegalArgumentException("Invalid JWT format");
            }
            
            String payloadJson = new String(Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8);
            
            // Extract attributes (simplistic JSON string search to avoid bringing in Jackson/Gson mapping boilerplates)
            String userId = extractJsonField(payloadJson, "sub");
            String role = extractJsonField(payloadJson, "role");
            String email = extractJsonField(payloadJson, "email");
            String tier = extractJsonField(payloadJson, "tier");
            String displayName = extractJsonField(payloadJson, "displayName");
            
            if (userId == null || role == null) {
                throw new IllegalArgumentException("Missing claims in token");
            }

            String userName = (displayName != null && !displayName.trim().isEmpty()) ? displayName : (email != null ? email : "User");

            // Inject user context headers for downstreams
            ServerHttpRequest mutatedRequest = request.mutate()
                    .header("X-User-Id", userId)
                    .header("X-User-Role", role)
                    .header("X-User-Email", email != null ? email : "")
                    .header("X-User-Tier", tier != null ? tier : "FREE")
                    .header("X-User-Name", userName)
                    .build();

            return chain.filter(exchange.mutate().request(mutatedRequest).build());

        } catch (Exception e) {
            exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
            return exchange.getResponse().setComplete();
        }
    }

    private String extractJsonField(String json, String field) {
        String pattern = "\"" + field + "\"\\s*:\\s*\"([^\"]*)\"";
        java.util.regex.Pattern r = java.util.regex.Pattern.compile(pattern);
        java.util.regex.Matcher m = r.matcher(json);
        if (m.find()) {
            return m.group(1);
        }
        return null;
    }

    @Override
    public int getOrder() {
        // Run after Correlation ID but before Rate Limiting
        return -5;
    }
}
