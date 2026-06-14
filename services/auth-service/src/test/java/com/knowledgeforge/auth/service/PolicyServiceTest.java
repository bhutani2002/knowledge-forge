package com.knowledgeforge.auth.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

public class PolicyServiceTest {

    private PolicyService policyService;

    @BeforeEach
    public void setUp() {
        policyService = new PolicyService();
    }

    @Test
    public void testGuestUserAccessToPrivateDoc_ShouldThrowException() {
        Map<String, Object> guestUser = Map.of(
                "role", "GUEST",
                "tier", "FREE"
        );

        Map<String, Object> privateDoc = Map.of(
                "owner_id", UUID.randomUUID().toString(),
                "visibility", "PRIVATE"
        );

        assertThrows(AccessDeniedException.class, () -> {
            policyService.evaluateQueryDocumentPolicy(guestUser, privateDoc);
        });
    }

    @Test
    public void testProUserAccessToPrivateDocOwned_ShouldNotThrowException() {
        String userId = UUID.randomUUID().toString();
        Map<String, Object> proUser = Map.of(
                "id", userId,
                "role", "USER",
                "tier", "PRO",
                "daily_query_count", 10
        );

        Map<String, Object> privateDoc = Map.of(
                "owner_id", userId,
                "visibility", "PRIVATE"
        );

        assertDoesNotThrow(() -> {
            policyService.evaluateQueryDocumentPolicy(proUser, privateDoc);
        });
    }

    @Test
    public void testUserUploadPolicy_StorageLimitExceeded_ShouldThrowException() {
        Map<String, Object> user = Map.of(
                "role", "USER",
                "tier", "FREE",
                "storage_used", 150L * 1024 * 1024 // 150MB, exceeds FREE limit of 100MB
        );

        Map<String, Object> workspace = new HashMap<>();

        assertThrows(AccessDeniedException.class, () -> {
            policyService.evaluateUploadDocumentPolicy(user, workspace);
        });
    }
}
