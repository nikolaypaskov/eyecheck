use anyhow::Result;
use serde::Serialize;

use crate::analyze::{self, VisualIssue};
use crate::compare;

#[derive(Debug, Serialize)]
pub struct EyecheckReport {
    pub ssim_score: f64,
    pub match_score: f64,
    pub passed: bool,
    pub issues: Vec<VisualIssue>,
    pub summary: String,
    pub diff_image_path: Option<String>,
    pub reference_path: String,
    pub render_path: String,
    pub timestamp: String,
}

pub async fn run(
    reference_path: &str,
    render_path: &str,
    threshold: f64,
    output_path: Option<&str>,
    context: Option<&str>,
) -> Result<EyecheckReport> {
    // Run structural comparison
    let compare_result = compare::run(reference_path, render_path, threshold, output_path)?;

    // Run semantic analysis
    let analyze_result = analyze::run(reference_path, render_path, context).await?;

    // Combine: pass only if both structural and semantic checks pass
    let passed = compare_result.passed && analyze_result.match_score >= 0.8;

    let timestamp = chrono_free_timestamp();

    Ok(EyecheckReport {
        ssim_score: compare_result.ssim_score,
        match_score: analyze_result.match_score,
        passed,
        issues: analyze_result.issues,
        summary: analyze_result.summary,
        diff_image_path: compare_result.diff_image_path,
        reference_path: reference_path.to_string(),
        render_path: render_path.to_string(),
        timestamp,
    })
}

/// Generate an ISO 8601 timestamp without pulling in the chrono crate.
fn chrono_free_timestamp() -> String {
    use std::time::SystemTime;
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    // Format as seconds-since-epoch (portable, no extra deps)
    format!("{secs}")
}
