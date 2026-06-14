# --- Build Stage ---
FROM maven:3.9.5-eclipse-temurin-21-alpine AS builder
WORKDIR /app
COPY pom.xml .
# Download dependencies first (cached layer)
RUN mvn dependency:go-offline -B
COPY src ./src
RUN mvn clean package -DskipTests -B && mv target/*-1.0.0.jar target/app.jar

# --- Runtime Stage ---
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

# Install curl for healthchecks
RUN apk add --no-cache curl

# Run as non-root for security
RUN addgroup -S spring && adduser -S spring -G spring
USER spring:spring

COPY --chown=spring:spring --from=builder /app/target/app.jar app.jar

# Spring actuator health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:${PORT:-8080}/actuator/health || exit 1

EXPOSE 8080
ENTRYPOINT ["java", "-XX:+UseG1GC", "-Djava.security.egd=file:/dev/./urandom", "-jar", "app.jar"]
