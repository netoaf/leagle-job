package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/santifer/career-ops/dashboard/internal/data"
	"github.com/santifer/career-ops/dashboard/internal/theme"
	"github.com/santifer/career-ops/dashboard/internal/ui/screens"
)

type viewState int

const (
	viewPipeline viewState = iota
	viewReport
)

type appModel struct {
	pipeline      screens.PipelineModel
	viewer        screens.ViewerModel
	state         viewState
	careerOpsPath string
	lastDataMod   time.Time
}

type dashboardRefreshMsg struct{}

const dashboardRefreshInterval = 2 * time.Second

func (m appModel) Init() tea.Cmd {
	return scheduleDashboardRefresh()
}

func (m appModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case dashboardRefreshMsg:
		var cmd tea.Cmd
		m, cmd = m.refreshDashboard(false)
		return m, tea.Batch(cmd, scheduleDashboardRefresh())

	case tea.KeyMsg:
		if msg.String() == "r" {
			return m.refreshDashboard(true)
		}
		if m.state == viewReport {
			vm, cmd := m.viewer.Update(msg)
			m.viewer = vm
			return m, cmd
		}
		pm, cmd := m.pipeline.Update(msg)
		m.pipeline = pm
		return m, cmd

	case tea.WindowSizeMsg:
		m.pipeline.Resize(msg.Width, msg.Height)
		if m.state == viewReport {
			m.viewer.Resize(msg.Width, msg.Height)
		}
		pm, cmd := m.pipeline.Update(msg)
		m.pipeline = pm
		return m, cmd

	case screens.PipelineClosedMsg:
		return m, tea.Quit

	case screens.PipelineLoadReportMsg:
		archetype, tldr, remote, comp := data.LoadReportSummary(msg.CareerOpsPath, msg.ReportPath)
		m.pipeline.EnrichReport(msg.ReportPath, archetype, tldr, remote, comp)
		return m, nil

	case screens.PipelineUpdateStatusMsg:
		err := data.UpdateApplicationStatus(msg.CareerOpsPath, msg.App, msg.NewStatus)
		if err != nil {
			return m, nil
		}
		_ = data.UpsertFollowupForStatusChange(msg.CareerOpsPath, msg.App, msg.NewStatus)
		apps := data.ParseApplications(m.careerOpsPath)
		metrics := data.ComputeMetrics(apps)
		m.pipeline.ReplaceData(apps, metrics)
		m.lastDataMod = applicationsModTime(m.careerOpsPath)
		return m, nil

	case screens.PipelineRunActionMsg:
		m.pipeline.SetActionRunning(msg.Action)
		return m, runPipelineAction(m.careerOpsPath, msg.Action)

	case screens.PipelineActionFinishedMsg:
		pm, cmd := m.pipeline.Update(msg)
		m.pipeline = pm
		if msg.RefreshDashboard {
			var refresh tea.Cmd
			m, refresh = m.refreshDashboard(true)
			return m, tea.Batch(cmd, refresh)
		}
		return m, cmd

	case screens.PipelineOpenReportMsg:
		m.viewer = screens.NewViewerModel(
			theme.NewTheme("catppuccin-mocha"),
			msg.Path, msg.Title,
			m.pipeline.Width(), m.pipeline.Height(),
		)
		m.state = viewReport
		return m, nil

	case screens.ViewerClosedMsg:
		m.state = viewPipeline
		return m, nil

	case screens.PipelineOpenURLMsg:
		url := msg.URL
		return m, func() tea.Msg {
			var cmd *exec.Cmd
			switch runtime.GOOS {
			case "darwin":
				cmd = exec.Command("open", url)
			case "linux":
				cmd = exec.Command("xdg-open", url)
			case "windows":
				cmd = exec.Command("cmd", "/c", "start", "", url)
			default:
				cmd = exec.Command("xdg-open", url)
			}
			_ = cmd.Start()
			return nil
		}

	}

	return m, nil
}

func (m appModel) View() string {
	if m.state == viewReport {
		return m.viewer.View()
	}
	return m.pipeline.View()
}

func scheduleDashboardRefresh() tea.Cmd {
	return tea.Tick(dashboardRefreshInterval, func(time.Time) tea.Msg {
		return dashboardRefreshMsg{}
	})
}

func (m appModel) refreshDashboard(force bool) (appModel, tea.Cmd) {
	modTime := applicationsModTime(m.careerOpsPath)
	if !force && !modTime.IsZero() && !m.lastDataMod.IsZero() && !modTime.After(m.lastDataMod) {
		return m, nil
	}

	apps := data.ParseApplications(m.careerOpsPath)
	if apps == nil {
		return m, nil
	}

	metrics := data.ComputeMetrics(apps)
	m.pipeline.ReplaceData(apps, metrics)
	m.lastDataMod = modTime

	for _, app := range apps {
		if app.ReportPath == "" {
			continue
		}
		archetype, tldr, remote, comp := data.LoadReportSummary(m.careerOpsPath, app.ReportPath)
		if archetype != "" || tldr != "" || remote != "" || comp != "" {
			m.pipeline.EnrichReport(app.ReportPath, archetype, tldr, remote, comp)
		}
	}

	return m, nil
}

func applicationsModTime(careerOpsPath string) time.Time {
	candidates := []string{
		filepath.Join(careerOpsPath, "applications.md"),
		filepath.Join(careerOpsPath, "data", "applications.md"),
	}

	for _, candidate := range candidates {
		info, err := os.Stat(candidate)
		if err == nil {
			return info.ModTime()
		}
	}

	return time.Time{}
}

func hasApplicationsFile(path string) bool {
	candidates := []string{
		filepath.Join(path, "applications.md"),
		filepath.Join(path, "data", "applications.md"),
	}
	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			return true
		}
	}
	return false
}

func resolveCareerOpsPath(pathFlag string) string {
	if pathFlag != "" && pathFlag != "." {
		return pathFlag
	}

	candidates := []string{"."}

	if exePath, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exePath)
		candidates = append(candidates, exeDir, filepath.Dir(exeDir))
	}

	if cwd, err := os.Getwd(); err == nil {
		candidates = append(candidates, cwd, filepath.Dir(cwd))
	}

	for _, candidate := range candidates {
		if hasApplicationsFile(candidate) {
			if abs, err := filepath.Abs(candidate); err == nil {
				return abs
			}
			return candidate
		}
	}

	return pathFlag
}

func runPipelineAction(careerOpsPath string, action screens.PipelineToolAction) tea.Cmd {
	return func() tea.Msg {
		args, ok := actionCommandArgs(action.ID)
		if !ok {
			return screens.PipelineActionFinishedMsg{
				Action:    action,
				Succeeded: false,
				Output:    "Unknown dashboard action: " + action.ID,
			}
		}

		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
		defer cancel()

		cmd := exec.CommandContext(ctx, npmExecutable(), args...)
		cmd.Dir = careerOpsPath
		outputBytes, err := cmd.CombinedOutput()
		output := summarizeCommandOutput(string(outputBytes), 12, 2600)

		if ctx.Err() == context.DeadlineExceeded {
			err = ctx.Err()
			output = strings.TrimSpace("Timed out after 15 minutes.\n" + output)
		}
		if err != nil {
			errText := err.Error()
			if output == "" {
				output = errText
			} else if !strings.Contains(output, errText) {
				output = strings.TrimSpace(output + "\n" + errText)
			}
		}

		return screens.PipelineActionFinishedMsg{
			Action:           action,
			Succeeded:        err == nil,
			Output:           output,
			RefreshDashboard: action.Writes,
		}
	}
}

func npmExecutable() string {
	if runtime.GOOS == "windows" {
		return "npm.cmd"
	}
	return "npm"
}

func actionCommandArgs(actionID string) ([]string, bool) {
	switch actionID {
	case "health":
		return []string{"run", "jobfinder:health"}, true
	case "search_pt_preview":
		return []string{"run", "jobfinder:new:dry-run", "--", "--limit", "80"}, true
	case "search_pt_write":
		return []string{"run", "jobfinder:new", "--", "--limit", "80", "--write-limit", "5"}, true
	case "deep_preview":
		return []string{"run", "jobfinder:deep:dry-run"}, true
	case "remote_preview":
		return []string{"run", "jobfinder:remote:dry-run", "--", "--limit", "80"}, true
	case "source_audit_preview":
		return []string{"run", "portals:audit", "--", "--dry-run", "--limit", "30"}, true
	case "source_cleanup":
		return []string{"run", "source-health:cleanup"}, true
	case "top10_action":
		return []string{"run", "top10-action", "--", "--top", "10"}, true
	case "cv_diff_top10":
		return []string{"run", "cv-tailor-diff", "--", "--top", "10"}, true
	case "draft_quality":
		return []string{"run", "draft-quality"}, true
	case "followups":
		return []string{"run", "followups"}, true
	case "followups_init":
		return []string{"run", "followups:init"}, true
	default:
		return nil, false
	}
}

func summarizeCommandOutput(output string, maxLines, maxChars int) string {
	output = strings.ReplaceAll(output, "\r\n", "\n")
	output = strings.ReplaceAll(output, "\r", "\n")
	rawLines := strings.Split(output, "\n")
	lines := make([]string, 0, len(rawLines))
	for _, line := range rawLines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if len(line) > 180 {
			line = line[:177] + "..."
		}
		lines = append(lines, line)
	}

	if len(lines) > maxLines {
		lines = lines[len(lines)-maxLines:]
	}
	result := strings.Join(lines, "\n")
	if len(result) > maxChars {
		result = result[len(result)-maxChars:]
		if idx := strings.Index(result, "\n"); idx >= 0 {
			result = result[idx+1:]
		}
		result = "... " + result
	}
	return strings.TrimSpace(result)
}

func main() {
	pathFlag := flag.String("path", ".", "Path to Leagle Job directory")
	flag.Parse()

	careerOpsPath := resolveCareerOpsPath(*pathFlag)

	// Load applications
	apps := data.ParseApplications(careerOpsPath)
	if apps == nil {
		fmt.Fprintf(os.Stderr, "Error: could not find applications.md in %s or %s/data/\n", careerOpsPath, careerOpsPath)
		os.Exit(1)
	}

	// Compute metrics
	metrics := data.ComputeMetrics(apps)

	// Batch-load all report summaries
	t := theme.NewTheme("catppuccin-mocha")
	pm := screens.NewPipelineModel(t, apps, metrics, careerOpsPath, 120, 40)

	for _, app := range apps {
		if app.ReportPath == "" {
			continue
		}
		archetype, tldr, remote, comp := data.LoadReportSummary(careerOpsPath, app.ReportPath)
		if archetype != "" || tldr != "" || remote != "" || comp != "" {
			pm.EnrichReport(app.ReportPath, archetype, tldr, remote, comp)
		}
	}

	m := appModel{
		pipeline:      pm,
		careerOpsPath: careerOpsPath,
		lastDataMod:   applicationsModTime(careerOpsPath),
	}

	p := tea.NewProgram(m, tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
