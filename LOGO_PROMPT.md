# E-Sniffer Logo Generation Prompt

## Ready-to-Use Prompt

```
3x3 grid logo generation for E-Sniffer Udang, modern electronic-nose dashboard brand. Frame 3x3 with equal spacing, off-white background (neutral warm #faf0e5, not pure white).

PROMPT:
Minimalist modern logo design for E-Sniffer Udang, an electronic-nose IoT dashboard for shrimp freshness monitoring. Central motif: stylized 'E' monogram formed by three interlocking sensor wave patterns representing MQ-137 (ammonia), MQ-136 (hydrogen sulfide), and MQ-4 (methane), with subtle DHT-22 droplet element integrated at base. Color palette: warm shrimp-shell accent (#d1602c / #e67e22) as primary accent on off-white #faf0e5 background, with clean negative space. Design style: clean vector, no gradients, no shadows, no 3D, no photorealism. Negative constraints: no text beyond "E-SNIFFER" in ultra-thin sans-serif capitalized, no clichés like generic fish silhouettes, no AI artwork texture, no noisy lines, no gradient mesh, no decorative elements, no blue-cyan dominant hues. Composition: three equal columns showing (1) monogram-only on warm accent, (2) monogram with "E-SNIFFER UDANG" wordmark below on off-white, (3) monogram with "E-SNIFFER" only in warm accent, (4) wave-pattern only with tech rhythm in warm accent, (5) DHT-22 droplet accent alone in warm accent, (6) sensor wave abstraction in warm accent, (7) circular badge with E icon on off-white, (8) horizontal stacked variant with warm accent below label, (9) favicon-square version with warm accent at 32px. All 9 logos at 256x256 pixels, crisp corners, scalable vector aesthetic. Brand tone: trustworthy, tech-driven, aquaculture-connected, shrimp-freshness visual identity. Render as pure SVG vectors, no embedded raster, no artist signatures, no watermarks.
```

## Prompt Engineering Techniques Used & Rationale (1 sentence)

The prompt employs domain-accurate color conditioning with shrimp-shell warm accent on off-white background, explicit prohibition of blue-cyan dominant hues to break UI template coupling, symbolic sensor wave motifs, and rigid structural grid specification to eliminate AI slop by forcing minimal vector design anchored to aquaculture semantics rather than existing dashboard color scheme.

## Breakdown of Design Decisions

1. **Color palette**: Warm shrimp-shell accent (#d1602c / #e67e22 / burnt orange) on off-white #faf0e5 background — directly referencing shrimp (udang) visual identity, distinct from the existing cyan-indigo dashboard; off-white avoids pure #ffffff "glare" while maintaining readability
2. **Sensor wave motifs**: MQ-137, MQ-136, MQ-4 represented as three interlocking waves — directly tied to the 5 gas sensors documented in SKPL and technical design
3. **DHT-22 droplet**: Subtle integration at base represents temperature/humidity sensing per the ESP32-S3 + Nextion setup
4. **Negative constraints**: Explicit prohibitions against gradients, shadows, 3D, textures, fish silhouettes, decorative elements, and blue-cyan dominant hues that typically produce "AI slop" and lock to existing UI template
5. **Grid composition**: 3x3 structure with deliberate variation across rows/columns — monogram-only, wordmark variants, wave abstractions, badge versions, favicon — all rendered against off-white background for dashboard compatibility
6. **Technical style**: Forced "pure SVG vectors, no embedded raster" to ensure scalability and professional output suitable for real branding across light backgrounds
7. **Domain anchoring**: Every symbol maps to documented project elements (sensors, ESP32, MQTT, PostgreSQL, Prisma) and shrimp (udang) visual identity so the output is meaningful, not generic tech slop; warm accent breaks the cyan-indigo coupling of the current repo