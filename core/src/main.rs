mod analyze;
mod compare;
mod diff_image;
mod report;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "eyecheck", version, about = "Visual regression testing CLI")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Structural/pixel comparison of two images
    Compare {
        /// Path to the baseline image
        #[arg(long)]
        baseline: String,

        /// Path to the test image
        #[arg(long)]
        test: String,

        /// SSIM threshold for pass/fail (0.0-1.0)
        #[arg(long, default_value = "0.95")]
        threshold: f64,

        /// Output path for the diff image
        #[arg(long)]
        output: Option<String>,

        /// Output result as JSON
        #[arg(long)]
        json: bool,
    },

    /// Semantic analysis using Claude Vision API
    Analyze {
        /// Path to the reference (design) image
        #[arg(long)]
        reference: String,

        /// Path to the rendered screenshot
        #[arg(long)]
        render: String,

        /// Optional context description
        #[arg(long)]
        context: Option<String>,

        /// Output result as JSON
        #[arg(long)]
        json: bool,
    },

    /// Full report combining compare + analyze
    Report {
        /// Path to the reference (design/baseline) image
        #[arg(long)]
        reference: String,

        /// Path to the rendered screenshot
        #[arg(long)]
        render: String,

        /// SSIM threshold for pass/fail (0.0-1.0)
        #[arg(long, default_value = "0.95")]
        threshold: f64,

        /// Output path for the diff image
        #[arg(long)]
        output: Option<String>,

        /// Optional context description
        #[arg(long)]
        context: Option<String>,

        /// Output result as JSON
        #[arg(long)]
        json: bool,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Compare {
            baseline,
            test,
            threshold,
            output,
            json,
        } => {
            let result = compare::run(&baseline, &test, threshold, output.as_deref())?;
            if json {
                println!("{}", serde_json::to_string_pretty(&result)?);
            } else {
                print_compare_result(&result);
            }
        }
        Commands::Analyze {
            reference,
            render,
            context,
            json,
        } => {
            let result = analyze::run(&reference, &render, context.as_deref()).await?;
            if json {
                println!("{}", serde_json::to_string_pretty(&result)?);
            } else {
                print_analyze_result(&result);
            }
        }
        Commands::Report {
            reference,
            render,
            threshold,
            output,
            context,
            json,
        } => {
            let result =
                report::run(&reference, &render, threshold, output.as_deref(), context.as_deref())
                    .await?;
            if json {
                println!("{}", serde_json::to_string_pretty(&result)?);
            } else {
                print_report(&result);
            }
        }
    }

    Ok(())
}

fn print_compare_result(r: &compare::CompareResult) {
    println!("SSIM Score:      {:.4}", r.ssim_score);
    println!("Passed:          {}", r.passed);
    println!("Diff Pixels:     {}/{}", r.diff_pixels, r.total_pixels);
    println!("Diff Percentage: {:.2}%", r.diff_percentage);
    if let Some(ref path) = r.diff_image_path {
        println!("Diff Image:      {path}");
    }
}

fn print_analyze_result(r: &analyze::AnalyzeResult) {
    println!("Match Score: {:.2}", r.match_score);
    println!("Summary:     {}", r.summary);
    if r.issues.is_empty() {
        println!("Issues:      None");
    } else {
        println!("Issues ({}):", r.issues.len());
        for issue in &r.issues {
            println!(
                "  [{:6}] {}: {} (expected: {}, actual: {})",
                issue.severity, issue.issue_type, issue.element, issue.expected, issue.actual
            );
            println!("           Suggestion: {}", issue.suggestion);
        }
    }
}

fn print_report(r: &report::EyecheckReport) {
    println!("=== Eyecheck Report ===");
    println!("Reference: {}", r.reference_path);
    println!("Render:    {}", r.render_path);
    println!("Timestamp: {}", r.timestamp);
    println!();
    println!("SSIM Score:  {:.4}", r.ssim_score);
    println!("Match Score: {:.2}", r.match_score);
    println!("Passed:      {}", r.passed);
    if let Some(ref path) = r.diff_image_path {
        println!("Diff Image:  {path}");
    }
    println!();
    println!("Summary: {}", r.summary);
    if !r.issues.is_empty() {
        println!();
        println!("Issues ({}):", r.issues.len());
        for issue in &r.issues {
            println!(
                "  [{:6}] {}: {} (expected: {}, actual: {})",
                issue.severity, issue.issue_type, issue.element, issue.expected, issue.actual
            );
            println!("           Suggestion: {}", issue.suggestion);
        }
    }
}
