package data

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/model"
)

func TestParseApplicationsPreservesTrackerIDsWithGaps(t *testing.T) {
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}

	tracker := `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 41 | 2026-08-07 | First | Junior Developer | 80/100 | Evaluated | - | - | - |
| 64 | 2026-08-07 | NTT DATA | Estágio Profissional | 75/100 | Evaluated | - | - | - |
`
	if err := os.WriteFile(filepath.Join(dataDir, "applications.md"), []byte(tracker), 0o644); err != nil {
		t.Fatal(err)
	}

	apps := ParseApplications(root)
	if len(apps) != 2 {
		t.Fatalf("expected 2 applications, got %d", len(apps))
	}
	if apps[0].Number != 41 {
		t.Fatalf("expected first tracker ID 41, got %d", apps[0].Number)
	}
	if apps[1].Number != 64 {
		t.Fatalf("expected second tracker ID 64, got %d", apps[1].Number)
	}
}

func TestScheduledStatusIsDistinctFromApplied(t *testing.T) {
	if got := NormalizeStatus("Scheduled"); got != "scheduled" {
		t.Fatalf("expected scheduled, got %q", got)
	}
	apps := []model.CareerApplication{
		{Status: "Scheduled"},
		{Status: "Applied"},
	}
	metrics := ComputeMetrics(apps)
	if metrics.ByStatus["scheduled"] != 1 || metrics.ByStatus["applied"] != 1 {
		t.Fatalf("unexpected metrics: %#v", metrics.ByStatus)
	}
}
