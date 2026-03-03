mod analyze;
mod antialiasing;
mod batch;
mod clustering;
mod compare;
mod diff_image;
mod junit;
mod report;
mod yiq;

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

        /// Ignore anti-aliased pixels in diff count
        #[arg(long, default_value = "true")]
        ignore_antialiasing: bool,

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

        /// Ignore anti-aliased pixels in diff count
        #[arg(long, default_value = "true")]
        ignore_antialiasing: bool,

        /// Optional context description
        #[arg(long)]
        context: Option<String>,

        /// Output result as JSON
        #[arg(long)]
        json: bool,
    },

    /// Batch comparison for CI/CD pipelines
    Batch {
        /// Path to the batch config JSON file
        #[arg(long)]
        config: String,

        /// Output directory for diff images
        #[arg(long)]
        output_dir: Option<String>,

        /// Output result as JSON
        #[arg(long)]
        json: bool,

        /// Output JUnit XML report to specified path
        #[arg(long)]
        junit: Option<String>,
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
            ignore_antialiasing,
            json,
        } => {
            let result =
                compare::run(&baseline, &test, threshold, output.as_deref(), ignore_antialiasing)?;
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
            ignore_antialiasing,
            context,
            json,
        } => {
            let result = report::run(
                &reference,
                &render,
                threshold,
                output.as_deref(),
                ignore_antialiasing,
                context.as_deref(),
            )
            .await?;
            if json {
                println!("{}", serde_json::to_string_pretty(&result)?);
            } else {
                print_report(&result);
            }
        }
        Commands::Batch {
            config,
            output_dir,
            json,
            junit,
        } => {
            let result = batch::run(&config, output_dir.as_deref())?;

            if let Some(junit_path) = junit {
                junit::write_report(&result, &junit_path)?;
                eprintln!("JUnit report written to: {junit_path}");
            }

            if json {
                println!("{}", serde_json::to_string_pretty(&result)?);
            } else {
                batch::print_result(&result);
            }

            // Exit code: 0 = all pass, 1 = any fail, 2 = any error
            if result.errors > 0 {
                std::process::exit(2);
            } else if result.failed > 0 {
                std::process::exit(1);
            }
        }
    }

    Ok(())
}

fn print_compare_result(r: &compare::CompareResult) {
    println!("SSIM Score:      {:.4}", r.ssim_score);
    println!("Passed:          {}", r.passed);
    println!("Diff Pixels:     {}/{}", r.diff_pixels, r.total_pixels);
    println!("AA Pixels:       {}", r.antialiased_pixels);
    println!("Diff Percentage: {:.2}%", r.diff_percentage);
    if !r.regions.is_empty() {
        println!("Regions:         {} changed areas", r.regions.len());
        for (i, region) in r.regions.iter().enumerate() {
            println!(
                "  Region {}: ({}, {}) {}x{} -- {} pixels",
                i + 1,
                region.x,
                region.y,
                region.width,
                region.height,
                region.pixel_count
            );
        }
    }
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
