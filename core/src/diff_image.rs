use anyhow::{Context, Result};
use image::{Rgba, RgbaImage};

use crate::{clustering, yiq};

/// Region color palette for distinct diff regions
const REGION_COLORS: [(u8, u8, u8); 5] = [
    (255, 0, 0),     // Region 0: Red
    (255, 165, 0),   // Region 1: Orange
    (255, 0, 255),   // Region 2: Magenta
    (0, 255, 255),   // Region 3: Cyan
    (255, 255, 0),   // Region 4+: Yellow
];

/// Generate a visual diff overlay highlighting pixel differences between two images.
///
/// Pixels that match are shown dimmed (semi-transparent grayscale).
/// Differing pixels are color-coded by region using YIQ delta for intensity.
/// Anti-aliased pixels (when ignore_antialiasing is true) are shown in yellow.
pub fn generate(
    baseline: &RgbaImage,
    test: &RgbaImage,
    output_path: &str,
    ignore_antialiasing: bool,
    diff_mask: &[bool],
    regions: &[clustering::DiffRegion],
) -> Result<()> {
    let (width, height) = baseline.dimensions();
    let mut diff = RgbaImage::new(width, height);

    for y in 0..height {
        for x in 0..width {
            let idx = (y * width + x) as usize;
            let bp = baseline.get_pixel(x, y);
            let tp = test.get_pixel(x, y);

            let is_diff = yiq::is_different(
                bp[0], bp[1], bp[2], bp[3], tp[0], tp[1], tp[2], tp[3],
                yiq::DEFAULT_THRESHOLD,
            );

            if is_diff {
                let delta = yiq::color_delta(
                    bp[0], bp[1], bp[2], bp[3], tp[0], tp[1], tp[2], tp[3],
                );
                let intensity_factor = (((delta.sqrt() / 188.0) * 200.0 + 55.0).min(255.0) / 255.0) as f32;

                if diff_mask[idx] {
                    // Real diff pixel — color by region
                    let (cr, cg, cb) = region_color_for_pixel(x, y, regions);
                    let r = (cr as f32 * intensity_factor) as u8;
                    let g = (cg as f32 * intensity_factor) as u8;
                    let b = (cb as f32 * intensity_factor) as u8;
                    diff.put_pixel(x, y, Rgba([r, g, b, 255]));
                } else if ignore_antialiasing {
                    // Anti-aliased pixel (in diff by YIQ but filtered out) — yellow
                    let intensity = (intensity_factor * 255.0) as u8;
                    diff.put_pixel(x, y, Rgba([intensity, intensity, 0, 255]));
                }
            } else {
                // Dim the matching pixels to grayscale
                let gray =
                    (0.299 * bp[0] as f32 + 0.587 * bp[1] as f32 + 0.114 * bp[2] as f32) as u8;
                let dimmed = gray / 3;
                diff.put_pixel(x, y, Rgba([dimmed, dimmed, dimmed, 180]));
            }
        }
    }

    diff.save(output_path)
        .with_context(|| format!("Failed to save diff image to {output_path}"))?;

    Ok(())
}

/// Determine the color for a diff pixel based on which region it belongs to.
fn region_color_for_pixel(x: u32, y: u32, regions: &[clustering::DiffRegion]) -> (u8, u8, u8) {
    for (i, region) in regions.iter().enumerate() {
        if x >= region.x
            && x < region.x + region.width
            && y >= region.y
            && y < region.y + region.height
        {
            let color_idx = i.min(REGION_COLORS.len() - 1);
            return REGION_COLORS[color_idx];
        }
    }
    // Fallback: red for pixels not in any region bounding box
    (255, 0, 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    #[test]
    fn test_diff_output_created() {
        let size = 50;
        let mut baseline = RgbaImage::new(size, size);
        let mut test_img = RgbaImage::new(size, size);

        for pixel in baseline.pixels_mut() {
            *pixel = Rgba([0, 0, 255, 255]);
        }
        for pixel in test_img.pixels_mut() {
            *pixel = Rgba([255, 0, 0, 255]);
        }

        let diff_mask = vec![true; (size * size) as usize];
        let regions = vec![clustering::DiffRegion {
            x: 0,
            y: 0,
            width: size,
            height: size,
            pixel_count: (size * size) as u64,
        }];

        let dir = std::env::temp_dir().join("eyecheck-diff-test");
        std::fs::create_dir_all(&dir).unwrap();
        let output = dir.join("diff_test.png");
        let output_str = output.to_string_lossy().to_string();

        generate(&baseline, &test_img, &output_str, true, &diff_mask, &regions).unwrap();
        assert!(output.exists(), "Diff image should be created");
    }

    #[test]
    fn test_diff_dimensions_match() {
        let width = 80;
        let height = 60;
        let mut baseline = RgbaImage::new(width, height);
        let mut test_img = RgbaImage::new(width, height);

        for pixel in baseline.pixels_mut() {
            *pixel = Rgba([100, 100, 100, 255]);
        }
        for pixel in test_img.pixels_mut() {
            *pixel = Rgba([200, 200, 200, 255]);
        }

        let diff_mask = vec![true; (width * height) as usize];
        let regions = vec![clustering::DiffRegion {
            x: 0,
            y: 0,
            width,
            height,
            pixel_count: (width * height) as u64,
        }];

        let dir = std::env::temp_dir().join("eyecheck-diff-test");
        std::fs::create_dir_all(&dir).unwrap();
        let output = dir.join("diff_dims.png");
        let output_str = output.to_string_lossy().to_string();

        generate(&baseline, &test_img, &output_str, true, &diff_mask, &regions).unwrap();

        let diff = image::open(&output).unwrap();
        assert_eq!(diff.width(), width, "Diff width should match input");
        assert_eq!(diff.height(), height, "Diff height should match input");
    }
}
