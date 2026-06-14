# KnowledgeForge Security Guidelines

This document outlines the security controls, threat models, and regulatory mapping for the KnowledgeForge AI platform.

---

## 1. OWASP Top 10 Mitigations Checklist

- **A01: Broken Access Control**: Checked using Spring Security controller filters and fine-grained service-layer Attribute-Based Access Control (`PolicyService`).
- **A02: Cryptographic Failures**: All user secrets are hashed using strong BCrypt (strength=12). JWT signatures verified via HMAC-SHA256. Cookies are marked HttpOnly, Secure, and SameSite=Strict.
- **A03: Injection**: All SQL queries utilize JPA/Hibernate parameterized operations. Python FastAPI input is scanned using `LengthGuard` and `InjectionGuard` filters.
- **A04: Insecure Design**: Secure defaults. Multi-tenant partitioning of document buckets and vector chunks by `workspace_id`.
- **A05: Security Misconfiguration**: Default ports mapped locally. Production values must be provided via external environment parameters.
- **A06: Vulnerable and Outdated Components**: Automated dependencies scans run within pipeline builds.
- **A07: Identification and Authentication Failures**: Single-use rotated refresh tokens. Account lockout brute force defenses tracked via Redis keys.
- **A08: Software and Data Integrity Failures**: Strict Docker builds pinning library hashes.
- **A09: Security Logging and Monitoring Failures**: All security milestones audited in Postgres `audit_log` and logged as structured JSON.
- **A10: Server-Side Request Forgery**: Restrict internal network range mappings on client-controlled document uploads.

---

## 2. NIST 800-53 Control Mapping

- **AC-2 (Account Management)**: Configured in `auth-service` supporting custom user signup controls.
- **AC-3 (Access Enforcement)**: Enforced via `PolicyService` verifying document ownership and active member role attributes.
- **AU-2 (Event Logging)**: Audit logs track login, logout, and document ingestion events.
- **IA-2 (Identification and Authentication)**: Decoded JWT verification blocks unauthorized gateway request propagation.
- **SC-8 (Transmission Integrity)**: SSL/TLS encryption enforced by upstream Nginx configurations.
