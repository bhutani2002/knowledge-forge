package com.knowledgeforge.document.config;

import jakarta.servlet.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.UUID;

@Component
public class TracingFilter implements Filter {

    public static final String CORRELATION_ID_HEADER = "X-Correlation-ID";
    public static final String SPAN_ID_HEADER = "X-Span-ID";

    public static final String MDC_TRACE_ID_KEY = "traceId";
    public static final String MDC_SPAN_ID_KEY = "spanId";

    @Override
    public void init(FilterConfig filterConfig) throws ServletException {}

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        if (request instanceof HttpServletRequest httpServletRequest) {
            String traceId = httpServletRequest.getHeader(CORRELATION_ID_HEADER);
            String spanId = httpServletRequest.getHeader(SPAN_ID_HEADER);

            if (traceId == null || traceId.trim().isEmpty()) {
                traceId = UUID.randomUUID().toString();
            }
            if (spanId == null || spanId.trim().isEmpty()) {
                spanId = UUID.randomUUID().toString().substring(0, 16);
            }

            MDC.put(MDC_TRACE_ID_KEY, traceId);
            MDC.put(MDC_SPAN_ID_KEY, spanId);

            if (response instanceof HttpServletResponse httpServletResponse) {
                httpServletResponse.setHeader(CORRELATION_ID_HEADER, traceId);
                httpServletResponse.setHeader(SPAN_ID_HEADER, spanId);
            }
        }

        try {
            chain.doFilter(request, response);
        } finally {
            MDC.remove(MDC_TRACE_ID_KEY);
            MDC.remove(MDC_SPAN_ID_KEY);
        }
    }

    @Override
    public void destroy() {}
}
