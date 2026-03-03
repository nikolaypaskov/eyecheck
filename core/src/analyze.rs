use anyhow::{bail, Context, Result};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Debug, Serialize)]
pub struct AnalyzeResult {
    pub match_score: f64,
    pub issues: Vec<VisualIssue>,
    pub summary: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VisualIssue {
    pub issue_type: String,
    pub element: String,
    pub actual: String,
    pub expected: String,
    pub severity: String,
    pub suggestion: String,
}

#[derive(Deserialize)]
struct ClaudeResponse {
    content: Vec<ContentBlock>,
}

#[derive(Deserialize)]
struct ContentBlock {
    text: Option<String>,
}

#[derive(Deserialize)]
struct AnalysisPayload {
    match_score: f64,
    issues: Vec<VisualIssue>,
    summary: String,
}

pub async fn run(
    reference_path: &str,
    render_path: &str,
    context: Option<&str>,
) -> Result<AnalyzeResult> {
    let api_key = std::env::var("ANTHROPIC_API_KEY")
        .context("ANTHROPIC_API_KEY environment variable not set")?;

    let reference_b64 = encode_image(reference_path)?;
    let render_b64 = encode_image(render_path)?;

    let context_text = context.unwrap_or("a web page component");

    let prompt = format!(
        r#"You are an expert visual QA engineer. Compare these two images:

Image 1 (reference/design): The intended design
Image 2 (render/screenshot): The actual rendered output

Context: This is {context_text}.

Analyze the visual differences and return a JSON object with this exact structure:
{{
  "match_score": <float 0.0-1.0 where 1.0 is perfect match>,
  "issues": [
    {{
      "issue_type": "<one of: spacing, color, typography, layout, alignment>",
      "element": "<CSS selector or description of the element>",
      "actual": "<what you see in the render>",
      "expected": "<what the reference shows>",
      "severity": "<one of: high, medium, low>",
      "suggestion": "<CSS fix or actionable suggestion>"
    }}
  ],
  "summary": "<one paragraph summary of the visual comparison>"
}}

Return ONLY the JSON object, no markdown fences, no extra text."#
    );

    let body = serde_json::json!({
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 4096,
        "messages": [{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": reference_b64,
                    }
                },
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": render_b64,
                    }
                },
                {
                    "type": "text",
                    "text": prompt,
                }
            ]
        }]
    });

    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .context("Failed to call Claude API")?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        bail!("Claude API returned {status}: {text}");
    }

    let claude_resp: ClaudeResponse = resp.json().await.context("Failed to parse Claude API response")?;

    let text = claude_resp
        .content
        .iter()
        .find_map(|block| block.text.as_ref())
        .context("No text content in Claude response")?;

    // Strip markdown fences if present
    let json_str = text
        .trim()
        .strip_prefix("```json")
        .or_else(|| text.trim().strip_prefix("```"))
        .unwrap_or(text.trim());
    let json_str = json_str.strip_suffix("```").unwrap_or(json_str).trim();

    let payload: AnalysisPayload =
        serde_json::from_str(json_str).context("Failed to parse analysis JSON from Claude")?;

    Ok(AnalyzeResult {
        match_score: payload.match_score,
        issues: payload.issues,
        summary: payload.summary,
    })
}

fn encode_image(path: &str) -> Result<String> {
    let data = fs::read(path).with_context(|| format!("Failed to read image: {path}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&data))
}
