use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;

use crate::compare;

#[derive(Debug, Deserialize)]
pub struct BatchConfig {
    pub checks: Vec<BatchCheck>,
    #[serde(default = "default_threshold")]
    pub threshold: f64,
    #[serde(default = "default_true")]
    pub ignore_antialiasing: bool,
}

#[derive(Debug, Deserialize)]
pub struct BatchCheck {
    pub name: String,
    pub baseline: String,
    pub test: String,
    #[serde(default)]
    pub threshold: Option<f64>,
}

fn default_threshold() -> f64 {
    0.95
}
fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize)]
pub struct BatchResult {
    pub total: usize,
    pub passed: usize,
    pub failed: usize,
    pub errors: usize,
    pub checks: Vec<BatchCheckResult>,
}

#[derive(Debug, Serialize)]
pub struct BatchCheckResult {
    pub name: String,
    pub status: String, // "pass", "fail", "error"
    pub ssim_score: Option<f64>,
    pub diff_pixels: Option<u64>,
    pub diff_percentage: Option<f64>,
    pub diff_image_path: Option<String>,
    pub error: Option<String>,
}

pub fn run(config_path: &str, output_dir: Option<&str>) -> Result<BatchResult> {
    let config_str = fs::read_to_string(config_path)
        .with_context(|| format!("Failed to read batch config: {config_path}"))?;
    let config: BatchConfig = serde_json::from_str(&config_str)
        .with_context(|| format!("Failed to parse batch config: {config_path}"))?;

    let mut results = Vec::new();
    let mut passed = 0usize;
    let mut failed = 0usize;
    let mut errors = 0usize;

    for check in &config.checks {
        let threshold = check.threshold.unwrap_or(config.threshold);

        let diff_path = output_dir.map(|dir| {
            let path = format!("{dir}/{}-diff.png", check.name);
            // Ensure directory exists
            if let Some(parent) = std::path::Path::new(&path).parent() {
                let _ = fs::create_dir_all(parent);
            }
            path
        });

        match compare::run(
            &check.baseline,
            &check.test,
            threshold,
            diff_path.as_deref(),
            config.ignore_antialiasing,
        ) {
            Ok(result) => {
                let status = if result.passed {
                    passed += 1;
                    "pass"
                } else {
                    failed += 1;
                    "fail"
                };

                results.push(BatchCheckResult {
                    name: check.name.clone(),
                    status: status.to_string(),
                    ssim_score: Some(result.ssim_score),
                    diff_pixels: Some(result.diff_pixels),
                    diff_percentage: Some(result.diff_percentage),
                    diff_image_path: result.diff_image_path,
                    error: None,
                });
            }
            Err(e) => {
                errors += 1;
                results.push(BatchCheckResult {
                    name: check.name.clone(),
                    status: "error".to_string(),
                    ssim_score: None,
                    diff_pixels: None,
                    diff_percentage: None,
                    diff_image_path: None,
                    error: Some(e.to_string()),
                });
            }
        }
    }

    Ok(BatchResult {
        total: config.checks.len(),
        passed,
        failed,
        errors,
        checks: results,
    })
}

pub fn print_batch_result(result: &BatchResult) {
    println!("=== Eyecheck Batch Results ===");
    println!(
        "Total: {}  Passed: {}  Failed: {}  Errors: {}",
        result.total, result.passed, result.failed, result.errors
    );
    println!();

    for check in &result.checks {
        let icon = match check.status.as_str() {
            "pass" => "PASS",
            "fail" => "FAIL",
            _ => "ERR ",
        };

        if let Some(ssim) = check.ssim_score {
            println!(
                "  [{}] {} — SSIM: {:.4}, Diff: {:.2}%",
                icon,
                check.name,
                ssim,
                check.diff_percentage.unwrap_or(0.0)
            );
        } else if let Some(ref err) = check.error {
            println!("  [{}] {} — {}", icon, check.name, err);
        }
    }
}

pub use print_batch_result as print_result;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_batch_config() {
        let json = r#"{
            "checks": [
                { "name": "test1", "baseline": "a.png", "test": "b.png" }
            ],
            "threshold": 0.90
        }"#;
        let config: BatchConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.checks.len(), 1);
        assert_eq!(config.threshold, 0.90);
        assert!(config.ignore_antialiasing);
    }

    #[test]
    fn parse_config_defaults() {
        let json = r#"{
            "checks": [
                { "name": "test1", "baseline": "a.png", "test": "b.png" }
            ]
        }"#;
        let config: BatchConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.threshold, 0.95);
        assert!(config.ignore_antialiasing);
    }
}
