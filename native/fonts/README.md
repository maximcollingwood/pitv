# Bundled fonts

The Bhakti House typefaces, copied from the design system's implementation
(`bhio-ui/wwwroot/css/fonts` and `lib/fontawesome` in bhio-utilities) and compiled
into the binary so the screen never depends on the network.

- Raleway (400, 500, 600, 700) and Parkinsans (500, 600, 700): Latin subsets,
  SIL Open Font License 1.1 (the license and copyright are in each file's name table).
- Font Awesome 6 Free, solid: see `fontawesome-LICENSE.txt` (icons CC BY 4.0, font OFL 1.1).

The subsets lack most precomposed IAST letters (ā, ś, ṛ); the controller
decomposes text into letter plus combining accent, which the subsets do cover.
