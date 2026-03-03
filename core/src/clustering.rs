use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct DiffRegion {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub pixel_count: u64,
}

/// Find connected regions of changed pixels using 8-connectivity flood fill.
/// Filters out clusters with fewer than `min_pixels` pixels (noise).
pub fn find_regions(diff_mask: &[bool], width: u32, height: u32, min_pixels: u64) -> Vec<DiffRegion> {
    let mut visited = vec![false; diff_mask.len()];
    let mut regions = Vec::new();

    for y in 0..height {
        for x in 0..width {
            let idx = (y * width + x) as usize;
            if diff_mask[idx] && !visited[idx] {
                // BFS flood fill
                let mut queue = std::collections::VecDeque::new();
                queue.push_back((x, y));
                visited[idx] = true;

                let mut min_x = x;
                let mut min_y = y;
                let mut max_x = x;
                let mut max_y = y;
                let mut pixel_count = 0u64;

                while let Some((cx, cy)) = queue.pop_front() {
                    pixel_count += 1;
                    min_x = min_x.min(cx);
                    min_y = min_y.min(cy);
                    max_x = max_x.max(cx);
                    max_y = max_y.max(cy);

                    // 8-connected neighbors
                    for dy in -1i32..=1 {
                        for dx in -1i32..=1 {
                            if dx == 0 && dy == 0 {
                                continue;
                            }
                            let nx = cx as i32 + dx;
                            let ny = cy as i32 + dy;
                            if nx < 0 || ny < 0 || nx >= width as i32 || ny >= height as i32 {
                                continue;
                            }
                            let ni = (ny as u32 * width + nx as u32) as usize;
                            if diff_mask[ni] && !visited[ni] {
                                visited[ni] = true;
                                queue.push_back((nx as u32, ny as u32));
                            }
                        }
                    }
                }

                if pixel_count >= min_pixels {
                    regions.push(DiffRegion {
                        x: min_x,
                        y: min_y,
                        width: max_x - min_x + 1,
                        height: max_y - min_y + 1,
                        pixel_count,
                    });
                }
            }
        }
    }

    // Sort by pixel count descending
    regions.sort_by(|a, b| b.pixel_count.cmp(&a.pixel_count));
    regions
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_single_region() {
        // 5x5 mask with a 3x3 block of diffs in the center
        let mut mask = vec![false; 25];
        for y in 1..4 {
            for x in 1..4 {
                mask[y * 5 + x] = true;
            }
        }
        let regions = find_regions(&mask, 5, 5, 1);
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].pixel_count, 9);
        assert_eq!(regions[0].x, 1);
        assert_eq!(regions[0].y, 1);
        assert_eq!(regions[0].width, 3);
        assert_eq!(regions[0].height, 3);
    }

    #[test]
    fn finds_multiple_regions() {
        // Two separate clusters
        let mut mask = vec![false; 100]; // 10x10
        // Cluster 1: top-left corner
        mask[0] = true;
        mask[1] = true;
        mask[10] = true;
        mask[11] = true;
        // Cluster 2: bottom-right corner
        mask[88] = true;
        mask[89] = true;
        mask[98] = true;
        mask[99] = true;

        let regions = find_regions(&mask, 10, 10, 1);
        assert_eq!(regions.len(), 2);
    }

    #[test]
    fn filters_noise() {
        let mut mask = vec![false; 25];
        mask[0] = true; // single pixel
        mask[12] = true; // single pixel
        // 4-pixel cluster
        mask[20] = true;
        mask[21] = true;
        mask[22] = true;
        mask[23] = true;

        let regions = find_regions(&mask, 5, 5, 4);
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].pixel_count, 4);
    }
}
