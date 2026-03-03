use anyhow::{Context, Result};
use std::fs;

use crate::batch::BatchResult;

/// Generate a JUnit XML report from batch results.
pub fn write_report(result: &BatchResult, output_path: &str) -> Result<()> {
    let mut xml = String::new();
    xml.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    xml.push_str(&format!(
        "<testsuites tests=\"{}\" failures=\"{}\" errors=\"{}\">\n",
        result.total, result.failed, result.errors
    ));
    xml.push_str(&format!(
        "  <testsuite name=\"eyecheck\" tests=\"{}\" failures=\"{}\" errors=\"{}\">\n",
        result.total, result.failed, result.errors
    ));

    for check in &result.checks {
        xml.push_str(&format!(
            "    <testcase name=\"{}\" classname=\"eyecheck.visual\"",
            escape_xml(&check.name)
        ));

        match check.status.as_str() {
            "pass" => {
                xml.push_str(">\n");
                if let Some(ssim) = check.ssim_score {
                    xml.push_str(&format!(
                        "      <system-out>SSIM: {:.4}, Diff: {:.2}%</system-out>\n",
                        ssim,
                        check.diff_percentage.unwrap_or(0.0)
                    ));
                }
                xml.push_str("    </testcase>\n");
            }
            "fail" => {
                xml.push_str(">\n");
                xml.push_str(&format!(
                    "      <failure message=\"Visual regression detected\" type=\"VisualDiff\">SSIM: {:.4}, Diff pixels: {}, Diff: {:.2}%</failure>\n",
                    check.ssim_score.unwrap_or(0.0),
                    check.diff_pixels.unwrap_or(0),
                    check.diff_percentage.unwrap_or(0.0),
                ));
                if let Some(ref diff_path) = check.diff_image_path {
                    xml.push_str(&format!(
                        "      <system-out>Diff image: {}</system-out>\n",
                        escape_xml(diff_path)
                    ));
                }
                xml.push_str("    </testcase>\n");
            }
            _ => {
                xml.push_str(">\n");
                xml.push_str(&format!(
                    "      <error message=\"{}\" type=\"ComparisonError\">{}</error>\n",
                    escape_xml(check.error.as_deref().unwrap_or("Unknown error")),
                    escape_xml(check.error.as_deref().unwrap_or("Unknown error")),
                ));
                xml.push_str("    </testcase>\n");
            }
        }
    }

    xml.push_str("  </testsuite>\n");
    xml.push_str("</testsuites>\n");

    fs::write(output_path, &xml)
        .with_context(|| format!("Failed to write JUnit report to {output_path}"))?;

    Ok(())
}

fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::batch::{BatchCheckResult, BatchResult};

    #[test]
    fn generates_valid_xml() {
        let result = BatchResult {
            total: 2,
            passed: 1,
            failed: 1,
            errors: 0,
            checks: vec![
                BatchCheckResult {
                    name: "homepage".to_string(),
                    status: "pass".to_string(),
                    ssim_score: Some(0.98),
                    diff_pixels: Some(100),
                    diff_percentage: Some(0.5),
                    diff_image_path: None,
                    error: None,
                },
                BatchCheckResult {
                    name: "about".to_string(),
                    status: "fail".to_string(),
                    ssim_score: Some(0.85),
                    diff_pixels: Some(5000),
                    diff_percentage: Some(12.5),
                    diff_image_path: Some("/tmp/diff.png".to_string()),
                    error: None,
                },
            ],
        };

        let dir = std::env::temp_dir().join("eyecheck-junit-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("report.xml").to_string_lossy().to_string();

        write_report(&result, &path).unwrap();

        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("<?xml"));
        assert!(content.contains("testsuites"));
        assert!(content.contains("homepage"));
        assert!(content.contains("failure"));
        assert!(content.contains("about"));
    }

    #[test]
    fn escapes_special_characters() {
        assert_eq!(escape_xml("a<b>c&d"), "a&lt;b&gt;c&amp;d");
    }
}
