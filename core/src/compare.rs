use anyhow::{Context, Result};
use image::{GenericImageView, GrayImage};
use image_compare::Algorithm;
use rayon::prelude::*;
use serde::Serialize;

use crate::{antialiasing, clustering, diff_image, yiq};

#[derive(Debug, Serialize)]
pub struct CompareResult {
    pub ssim_score: f64,
    pub passed: bool,
    pub diff_pixels: u64,
    pub total_pixels: u64,
    pub diff_percentage: f64,
    pub antialiased_pixels: u64,
    pub regions: Vec<clustering::DiffRegion>,
    pub diff_image_path: Option<String>,
}

pub fn run(
    baseline_path: &str,
    test_path: &str,
    threshold: f64,
    output_path: Option<&str>,
    ignore_antialiasing: bool,
) -> Result<CompareResult> {
    let baseline = image::open(baseline_path)
        .with_context(|| format!("Failed to open baseline image: {baseline_path}"))?;
    let test = image::open(test_path)
        .with_context(|| format!("Failed to open test image: {test_path}"))?;

    // Resize test to match baseline if dimensions differ
    let test = if baseline.dimensions() != test.dimensions() {
        test.resize_exact(
            baseline.width(),
            baseline.height(),
            image::imageops::FilterType::Lanczos3,
        )
    } else {
        test
    };

    // SSIM comparison on grayscale versions
    let baseline_gray: GrayImage = baseline.to_luma8();
    let test_gray: GrayImage = test.to_luma8();

    let ssim_result =
        image_compare::gray_similarity_structure(&Algorithm::MSSIMSimple, &baseline_gray, &test_gray)
            .context("SSIM comparison failed")?;
    let ssim_score = ssim_result.score;

    // Pixel-level YIQ diff with optional anti-aliasing detection (Rayon parallel by rows)
    let baseline_rgba = baseline.to_rgba8();
    let test_rgba = test.to_rgba8();

    let (width, height) = baseline_rgba.dimensions();
    let total_pixels = (width as u64) * (height as u64);

    let row_results: Vec<(u64, u64, Vec<bool>)> = (0..height)
        .into_par_iter()
        .map(|y| {
            let mut diff_count = 0u64;
            let mut aa_count = 0u64;
            let mut row_mask = Vec::with_capacity(width as usize);

            for x in 0..width {
                let bp = baseline_rgba.get_pixel(x, y);
                let tp = test_rgba.get_pixel(x, y);

                if yiq::is_different(
                    bp[0], bp[1], bp[2], bp[3], tp[0], tp[1], tp[2], tp[3],
                    yiq::DEFAULT_THRESHOLD,
                ) {
                    if ignore_antialiasing
                        && antialiasing::is_antialiased(&baseline_rgba, &test_rgba, x, y)
                    {
                        aa_count += 1;
                        row_mask.push(false);
                    } else {
                        diff_count += 1;
                        row_mask.push(true);
                    }
                } else {
                    row_mask.push(false);
                }
            }

            (diff_count, aa_count, row_mask)
        })
        .collect();

    let mut diff_pixels = 0u64;
    let mut antialiased_pixels = 0u64;
    let mut diff_mask: Vec<bool> = Vec::with_capacity((width * height) as usize);

    for (dc, ac, row) in row_results {
        diff_pixels += dc;
        antialiased_pixels += ac;
        diff_mask.extend(row);
    }

    let diff_percentage = (diff_pixels as f64 / total_pixels as f64) * 100.0;
    let passed = ssim_score >= threshold;

    // Find connected regions of diff pixels
    let regions = clustering::find_regions(&diff_mask, width, height, 4);

    // Generate diff overlay image if output requested
    let diff_image_path = if let Some(out) = output_path {
        diff_image::generate(&baseline_rgba, &test_rgba, out, ignore_antialiasing, &diff_mask, &regions)?;
        Some(out.to_string())
    } else {
        None
    };

    Ok(CompareResult {
        ssim_score,
        passed,
        diff_pixels,
        total_pixels,
        diff_percentage,
        antialiased_pixels,
        regions,
        diff_image_path,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};
    use std::fs;

    fn create_test_dir() -> String {
        let dir = std::env::temp_dir().join("eyecheck-test");
        fs::create_dir_all(&dir).unwrap();
        dir.to_string_lossy().to_string()
    }

    fn save_solid_image(path: &str, r: u8, g: u8, b: u8, size: u32) {
        let mut img = RgbaImage::new(size, size);
        for pixel in img.pixels_mut() {
            *pixel = Rgba([r, g, b, 255]);
        }
        img.save(path).unwrap();
    }

    #[test]
    fn test_identical_images_high_ssim() {
        let dir = create_test_dir();
        let baseline = format!("{dir}/identical_baseline.png");
        let test_img = format!("{dir}/identical_test.png");

        save_solid_image(&baseline, 0, 0, 255, 100);
        save_solid_image(&test_img, 0, 0, 255, 100);

        let result = run(&baseline, &test_img, 0.95, None, true).unwrap();
        assert!(result.ssim_score > 0.99, "SSIM should be ~1.0 for identical images, got {}", result.ssim_score);
        assert!(result.passed, "Should pass with identical images");
        assert_eq!(result.diff_percentage, 0.0, "No pixel differences expected");
        assert!(result.regions.is_empty(), "No regions expected for identical images");
    }

    #[test]
    fn test_different_images_low_ssim() {
        let dir = create_test_dir();
        let baseline = format!("{dir}/diff_baseline.png");
        let test_img = format!("{dir}/diff_test.png");

        save_solid_image(&baseline, 0, 0, 255, 100);  // blue
        save_solid_image(&test_img, 255, 0, 0, 100);   // red

        let result = run(&baseline, &test_img, 0.95, None, true).unwrap();
        assert!(result.ssim_score < 0.95, "SSIM should be below threshold for different images, got {}", result.ssim_score);
        assert!(!result.passed, "Should fail with different images");
        assert!(!result.regions.is_empty(), "Should have regions for different images");
    }

    #[test]
    fn test_diff_pixels_count() {
        let dir = create_test_dir();
        let baseline = format!("{dir}/count_baseline.png");
        let test_img = format!("{dir}/count_test.png");

        save_solid_image(&baseline, 0, 0, 255, 100);  // blue
        save_solid_image(&test_img, 255, 0, 0, 100);   // red

        let result = run(&baseline, &test_img, 0.95, None, true).unwrap();
        assert!(result.diff_pixels > 0, "Should have diff pixels for different images");
        assert!(result.diff_percentage > 0.0, "Should have non-zero diff percentage");
        assert_eq!(result.total_pixels, 10000, "100x100 image should have 10000 pixels");
    }

    #[test]
    fn test_diff_output_generated() {
        let dir = create_test_dir();
        let baseline = format!("{dir}/out_baseline.png");
        let test_img = format!("{dir}/out_test.png");
        let diff_out = format!("{dir}/out_diff.png");

        save_solid_image(&baseline, 0, 0, 255, 100);
        save_solid_image(&test_img, 255, 0, 0, 100);

        let result = run(&baseline, &test_img, 0.95, Some(&diff_out), true).unwrap();
        assert!(result.diff_image_path.is_some(), "Should have diff image path");
        assert!(std::path::Path::new(&diff_out).exists(), "Diff image file should exist");
    }

    #[test]
    fn generate_test_fixtures() {
        let fixture_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../test/fixtures");
        fs::create_dir_all(fixture_dir).unwrap();

        save_solid_image(&format!("{fixture_dir}/reference.png"), 0, 0, 255, 100);
        save_solid_image(&format!("{fixture_dir}/render-match.png"), 0, 0, 255, 100);
        save_solid_image(&format!("{fixture_dir}/render-diff.png"), 255, 0, 0, 100);

        assert!(std::path::Path::new(&format!("{fixture_dir}/reference.png")).exists());
        assert!(std::path::Path::new(&format!("{fixture_dir}/render-match.png")).exists());
        assert!(std::path::Path::new(&format!("{fixture_dir}/render-diff.png")).exists());
    }
}
