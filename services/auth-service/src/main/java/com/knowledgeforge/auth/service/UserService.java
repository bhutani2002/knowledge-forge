package com.knowledgeforge.auth.service;

import com.knowledgeforge.auth.model.User;
import com.knowledgeforge.auth.repository.UserRepository;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

@Service
public class UserService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    public UserService(UserRepository userRepository, PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
    }

    public User findOrCreateOAuthUser(String email, String name, String provider) {
        Optional<User> existingUser = userRepository.findByEmail(email);
        if (existingUser.isPresent()) {
            User user = existingUser.get();
            // Update auth provider if not set or mismatched
            if (!provider.equals(user.getAuthProvider())) {
                user.setAuthProvider(provider);
                userRepository.save(user);
            }
            return user;
        }

        // Generate dummy password for OAuth users (it's nullable, but we hash a random UUID for security fallback)
        String randomPassword = UUID.randomUUID().toString();
        User newUser = new User(
                email,
                passwordEncoder.encode(randomPassword),
                "USER",
                "FREE",
                name,
                provider
        );
        newUser.setCreatedAt(Instant.now());
        newUser.setUpdatedAt(Instant.now());
        newUser.setEmailVerified(true);
        
        return userRepository.save(newUser);
    }
}
