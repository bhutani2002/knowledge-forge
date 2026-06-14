package com.knowledgeforge.auth.security;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.auth0.jwt.interfaces.DecodedJWT;
import com.knowledgeforge.auth.model.User;
import org.springframework.stereotype.Component;

import java.util.Date;

@Component
public class JwtUtil {

    @org.springframework.beans.factory.annotation.Value("${JWT_SECRET_KEY:32_bytes_long_random_hex_string_for_security_keys_here}")
    private String secretKey;

    private static final long ACCESS_TOKEN_EXPIRY = 15 * 60 * 1000; // 15 minutes
    private static final long REFRESH_TOKEN_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days

    private Algorithm getAlgorithm() {
        return Algorithm.HMAC256(secretKey);
    }

    public String generateAccessToken(User user) {
        return JWT.create()
                .withSubject(user.getId().toString())
                .withClaim("email", user.getEmail())
                .withClaim("role", user.getRole())
                .withClaim("tier", user.getTier())
                .withIssuedAt(new Date())
                .withExpiresAt(new Date(System.currentTimeMillis() + ACCESS_TOKEN_EXPIRY))
                .sign(getAlgorithm());
    }

    public String generateRefreshToken(User user) {
        return JWT.create()
                .withSubject(user.getId().toString())
                .withIssuedAt(new Date())
                .withExpiresAt(new Date(System.currentTimeMillis() + REFRESH_TOKEN_EXPIRY))
                .sign(getAlgorithm());
    }

    public DecodedJWT validateToken(String token) {
        return JWT.require(getAlgorithm())
                .build()
                .verify(token);
    }
}
