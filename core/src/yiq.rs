/// YIQ perceptual color difference.
/// Based on Pixelmatch's implementation.
/// Returns a weighted perceptual delta — higher means more noticeable.

pub fn color_delta(r1: u8, g1: u8, b1: u8, a1: u8, r2: u8, g2: u8, b2: u8, a2: u8) -> f64 {
    // Blend alpha with white background if not fully opaque
    let (r1, g1, b1) = blend(r1, g1, b1, a1);
    let (r2, g2, b2) = blend(r2, g2, b2, a2);

    let y1 = r1 * 0.29889531 + g1 * 0.58662247 + b1 * 0.11448223;
    let i1 = r1 * 0.59597799 - g1 * 0.27417610 - b1 * 0.32180189;
    let q1 = r1 * 0.21147017 - g1 * 0.52261711 + b1 * 0.31114694;

    let y2 = r2 * 0.29889531 + g2 * 0.58662247 + b2 * 0.11448223;
    let i2 = r2 * 0.59597799 - g2 * 0.27417610 - b2 * 0.32180189;
    let q2 = r2 * 0.21147017 - g2 * 0.52261711 + b2 * 0.31114694;

    let dy = y1 - y2;
    let di = i1 - i2;
    let dq = q1 - q2;

    // Weighted YIQ delta (Pixelmatch formula)
    0.5053 * dy * dy + 0.299 * di * di + 0.1957 * dq * dq
}

/// Blend a pixel with a white background based on alpha
fn blend(r: u8, g: u8, b: u8, a: u8) -> (f64, f64, f64) {
    let alpha = a as f64 / 255.0;
    (
        r as f64 * alpha + 255.0 * (1.0 - alpha),
        g as f64 * alpha + 255.0 * (1.0 - alpha),
        b as f64 * alpha + 255.0 * (1.0 - alpha),
    )
}

/// Default threshold for "noticeable" difference (Pixelmatch default: 0.1 squared)
/// Since color_delta returns sum of squared weighted components,
/// comparing against threshold^2 * max_delta
pub const DEFAULT_THRESHOLD: f64 = 0.1;

/// Check if the YIQ delta exceeds the threshold
pub fn is_different(
    r1: u8,
    g1: u8,
    b1: u8,
    a1: u8,
    r2: u8,
    g2: u8,
    b2: u8,
    a2: u8,
    threshold: f64,
) -> bool {
    // Maximum possible delta (black vs white)
    let max_delta = 35215.0; // pre-computed for speed
    let delta = color_delta(r1, g1, b1, a1, r2, g2, b2, a2);
    delta > max_delta * threshold * threshold
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_pixels_zero_delta() {
        let d = color_delta(100, 150, 200, 255, 100, 150, 200, 255);
        assert_eq!(d, 0.0);
    }

    #[test]
    fn different_pixels_nonzero_delta() {
        let d = color_delta(0, 0, 255, 255, 255, 0, 0, 255);
        assert!(d > 0.0);
    }

    #[test]
    fn is_different_works() {
        assert!(!is_different(
            100, 100, 100, 255, 101, 100, 100, 255,
            DEFAULT_THRESHOLD
        ));
        assert!(is_different(
            0, 0, 0, 255, 255, 255, 255, 255,
            DEFAULT_THRESHOLD
        ));
    }

    #[test]
    fn alpha_blending() {
        // Fully transparent should be white
        let (r, g, b) = blend(0, 0, 0, 0);
        assert_eq!(r, 255.0);
        assert_eq!(g, 255.0);
        assert_eq!(b, 255.0);
    }
}
