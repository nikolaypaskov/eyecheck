use anyhow::{Context, Result};
use image::{Rgba, RgbaImage};

/// Generate a visual diff overlay highlighting pixel differences between two images.
///
/// Pixels that match are shown dimmed (semi-transparent grayscale),
/// while differing pixels are highlighted in red with intensity proportional
/// to the magnitude of the difference.
pub fn generate(baseline: &RgbaImage, test: &RgbaImage, output_path: &str) -> Result<()> {
    let (width, height) = baseline.dimensions();
    let mut diff = RgbaImage::new(width, height);

    for y in 0..height {
        for x in 0..width {
            let bp = baseline.get_pixel(x, y);
            let tp = test.get_pixel(x, y);

            let dr = (bp[0] as i16 - tp[0] as i16).unsigned_abs() as u8;
            let dg = (bp[1] as i16 - tp[1] as i16).unsigned_abs() as u8;
            let db = (bp[2] as i16 - tp[2] as i16).unsigned_abs() as u8;
            let da = (bp[3] as i16 - tp[3] as i16).unsigned_abs() as u8;

            let max_diff = dr.max(dg).max(db).max(da);

            if max_diff > 2 {
                // Highlight differences in red, intensity scaled by magnitude
                let intensity = ((max_diff as f32 / 255.0) * 200.0 + 55.0).min(255.0) as u8;
                diff.put_pixel(x, y, Rgba([intensity, 0, 0, 255]));
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

        let dir = std::env::temp_dir().join("eyecheck-diff-test");
        std::fs::create_dir_all(&dir).unwrap();
        let output = dir.join("diff_test.png");
        let output_str = output.to_string_lossy().to_string();

        generate(&baseline, &test_img, &output_str).unwrap();
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

        let dir = std::env::temp_dir().join("eyecheck-diff-test");
        std::fs::create_dir_all(&dir).unwrap();
        let output = dir.join("diff_dims.png");
        let output_str = output.to_string_lossy().to_string();

        generate(&baseline, &test_img, &output_str).unwrap();

        let diff = image::open(&output).unwrap();
        assert_eq!(diff.width(), width, "Diff width should match input");
        assert_eq!(diff.height(), height, "Diff height should match input");
    }
}
