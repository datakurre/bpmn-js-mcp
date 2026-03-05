/**
 * TDD tests for svgToPng font rendering.
 *
 * The @resvg/resvg-js renderer needs system font paths so that text labels
 * inside SVG diagrams are rendered as visible glyphs rather than empty boxes.
 *
 * These tests verify that:
 * 1. svgToPng returns a non-empty PNG buffer.
 * 2. An SVG containing a <text> element produces a larger PNG than a blank SVG
 *    (rough proxy for "text was rendered").
 */
import { describe, test, expect } from 'vitest';
import { svgToPng } from '../src/svg-to-png';

const BLANK_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
  <rect width="200" height="100" fill="white"/>
</svg>`;

const TEXT_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
  <rect width="200" height="100" fill="white"/>
  <text x="20" y="60" font-family="Liberation Sans,Arial,sans-serif" font-size="20" fill="black">Hello World</text>
</svg>`;

describe('svgToPng', () => {
  test('returns a non-empty Buffer', () => {
    const png = svgToPng(BLANK_SVG);
    expect(png).toBeInstanceOf(Buffer);
    expect(png.length).toBeGreaterThan(0);
  });

  test('PNG starts with the PNG magic bytes', () => {
    const png = svgToPng(BLANK_SVG);
    // PNG magic: 89 50 4E 47 0D 0A 1A 0A
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50); // 'P'
    expect(png[2]).toBe(0x4e); // 'N'
    expect(png[3]).toBe(0x47); // 'G'
  });

  test('SVG with text produces a larger PNG than blank SVG', () => {
    const blankPng = svgToPng(BLANK_SVG);
    const textPng = svgToPng(TEXT_SVG);
    // When text glyphs are rendered, the PNG contains more non-trivial pixel
    // data, resulting in a larger compressed file.  If fonts are missing resvg
    // renders the text as nothing (same as blank), so the sizes would be equal.
    expect(textPng.length).toBeGreaterThan(blankPng.length);
  });

  test('PNG dimensions match SVG viewBox', () => {
    // Verify the PNG metadata encodes correct width/height.
    // PNG IHDR chunk starts at byte 16 and contains width (4 bytes) then height (4 bytes).
    const png = svgToPng(BLANK_SVG);
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    expect(width).toBe(200);
    expect(height).toBe(100);
  });
});
