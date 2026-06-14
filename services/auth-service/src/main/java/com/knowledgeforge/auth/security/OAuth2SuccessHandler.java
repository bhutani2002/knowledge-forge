package com.knowledgeforge.auth.security;

import com.knowledgeforge.auth.model.User;
import com.knowledgeforge.auth.service.UserService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.security.web.authentication.SimpleUrlAuthenticationSuccessHandler;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.time.Duration;

@Component
public class OAuth2SuccessHandler extends SimpleUrlAuthenticationSuccessHandler {

    private static final Logger logger = LoggerFactory.getLogger(OAuth2SuccessHandler.class);

    private final UserService userService;
    private final JwtUtil jwtUtil;
    private final StringRedisTemplate redisTemplate;

    public OAuth2SuccessHandler(UserService userService, JwtUtil jwtUtil, StringRedisTemplate redisTemplate) {
        this.userService = userService;
        this.jwtUtil = jwtUtil;
        this.redisTemplate = redisTemplate;
    }

    @Override
    public void onAuthenticationSuccess(HttpServletRequest request,
                                        HttpServletResponse response,
                                        Authentication authentication) throws IOException {

        String email = null;
        String name = null;

        Object principal = authentication.getPrincipal();
        if (principal instanceof OidcUser oidcUser) {
            email = oidcUser.getEmail();
            name = oidcUser.getFullName();
            if (name == null) {
                name = oidcUser.getClaimAsString("name");
            }
        } else if (principal instanceof OAuth2User oauth2User) {
            email = oauth2User.getAttribute("email");
            name = oauth2User.getAttribute("name");
            if (email == null) {
                email = oauth2User.getAttribute("preferred_username");
            }
        }

        if (email == null) {
            logger.error("OAuth2 authentication succeeded but email is null");
            response.sendRedirect("http://localhost:5173/login?error=oauth_no_email");
            return;
        }

        if (name == null || name.trim().isEmpty()) {
            name = email.split("@")[0];
        }

        String provider = determineProvider(authentication);
        logger.info("OAuth2 login successful for email: {}, provider: {}", email, provider);

        // Find or create user in PostgreSQL
        User user = userService.findOrCreateOAuthUser(email, name, provider);

        // Issue our own JWT
        String accessToken = jwtUtil.generateAccessToken(user);
        String refreshToken = jwtUtil.generateRefreshToken(user);

        // Store refresh token in Redis
        redisTemplate.opsForValue().set(
                "refreshtoken:" + refreshToken, user.getId().toString(), Duration.ofDays(7)
        );

        // Set httpOnly cookies
        ResponseCookie jwtCookie = ResponseCookie.from("jwt_token", accessToken)
                .httpOnly(true)
                .secure(false) // Set to false since local is http
                .sameSite("Lax")
                .path("/")
                .maxAge(900)
                .build();

        ResponseCookie refreshCookie = ResponseCookie.from("refresh_token", refreshToken)
                .httpOnly(true)
                .secure(false)
                .sameSite("Lax")
                .path("/api/auth/refresh")
                .maxAge(604800)
                .build();

        response.addHeader(HttpHeaders.SET_COOKIE, jwtCookie.toString());
        response.addHeader(HttpHeaders.SET_COOKIE, refreshCookie.toString());

        // Redirect to frontend callback
        getRedirectStrategy().sendRedirect(request, response,
                "http://localhost:5173/auth/callback?success=true");
    }

    private String determineProvider(Authentication auth) {
        if (auth instanceof OAuth2AuthenticationToken oauthToken) {
            return oauthToken.getAuthorizedClientRegistrationId().toUpperCase();
        }
        return auth.getName().contains("google") ? "GOOGLE" : "MICROSOFT";
    }
}
