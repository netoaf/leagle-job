package screens

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/santifer/career-ops/dashboard/internal/model"
)

// PipelineToolAction describes a safe local CareerOps command exposed in the dashboard.
type PipelineToolAction struct {
	ID            string
	Label         string
	Description   string
	Writes        bool
	ApplicationID int
}

// PipelineRunActionMsg requests execution of a local CareerOps tool action.
type PipelineRunActionMsg struct {
	Action PipelineToolAction
}

// PipelineActionFinishedMsg reports the result of a local CareerOps tool action.
type PipelineActionFinishedMsg struct {
	Action           PipelineToolAction
	Succeeded        bool
	Blocked          bool
	Output           string
	RefreshDashboard bool
}

var toolActions = []PipelineToolAction{
	{ID: "health", Label: "Health check", Description: "Run full Leagle Job validation."},
	{ID: "search_pt_preview", Label: "Search PT preview", Description: "Find new Portugal-first jobs without writing."},
	{ID: "search_pt_write", Label: "Search PT + write 5", Description: "Find new jobs and add up to 5 selected jobs to dashboard.", Writes: true},
	{ID: "deep_preview", Label: "Deep search preview", Description: "Run the broader Portugal-first scan without writing."},
	{ID: "remote_preview", Label: "Remote/EU preview", Description: "Search remote and Europe sources without writing."},
	{ID: "source_audit_preview", Label: "Source audit preview", Description: "Check a sample of source health without replacing files."},
	{ID: "source_cleanup", Label: "Source cleanup plan", Description: "Write a safe dead/blocked/fetch-failed cleanup report.", Writes: true},
	{ID: "top10_action", Label: "Top 10 action mode", Description: "Build packs and one execution checklist for the strongest jobs.", Writes: true},
	{ID: "cv_diff_top10", Label: "CV diff top 10", Description: "Create safe CV tailoring diffs for strongest jobs.", Writes: true},
	{ID: "draft_quality", Label: "Draft quality gate", Description: "Validate generated application-pack email drafts."},
	{ID: "followups", Label: "Follow-ups due", Description: "List due follow-ups and open next actions."},
	{ID: "followups_init", Label: "Init follow-ups", Description: "Create missing follow-up rows for active applications.", Writes: true},
}

func (m PipelineModel) handleActionPicker(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	switch msg.String() {
	case "esc", "q":
		m.actionPicker = false
		m.actionConfirm = false
		return m, nil

	case "down":
		m.actionCursor++
		if m.actionCursor >= len(toolActions) {
			m.actionCursor = len(toolActions) - 1
		}
		m.actionConfirm = false

	case "up":
		m.actionCursor--
		if m.actionCursor < 0 {
			m.actionCursor = 0
		}
		m.actionConfirm = false

	case "enter":
		if m.actionCursor < 0 || m.actionCursor >= len(toolActions) {
			return m, nil
		}
		action := toolActions[m.actionCursor]
		if action.Writes && !m.actionConfirm {
			m.actionConfirm = true
			return m, nil
		}
		m.actionPicker = false
		m.actionConfirm = false
		m.actionRunning = true
		m.actionMessage = "Running: " + action.Label
		m.actionOutput = ""
		return m, func() tea.Msg {
			return PipelineRunActionMsg{Action: action}
		}
	}
	return m, nil
}

func (m PipelineModel) currentApplicationHelp() (string, string) {
	app, ok := m.CurrentApp()
	if !ok {
		return "-", "sem ação"
	}
	channel := strings.ToLower(strings.TrimSpace(app.ApplyChannel))
	if channel == "email" {
		return "D", "criar draft Gmail"
	}
	if isPortalApplyChannel(channel) {
		return "P", "preparar candidatura"
	}
	return "!", "canal por confirmar"
}

func applicationButton(app model.CareerApplication) (string, string, bool) {
	channel := strings.ToLower(strings.TrimSpace(app.ApplyChannel))
	if channel == "email" {
		enabled := strings.Contains(app.ApplyRecipient, "@") && !isBlockedApplyStatus(app.ApplyStatus)
		if enabled {
			return "[ D ] CRIAR DRAFT GMAIL", "Cria um rascunho real no Gmail com o CV correto; nunca envia.", true
		}
		return "[ ! ] EMAIL BLOQUEADO", applicationBlockReason(app), false
	}
	if isPortalApplyChannel(channel) {
		if isBlockedApplyStatus(app.ApplyStatus) {
			return "[ ! ] CANDIDATURA BLOQUEADA", applicationBlockReason(app), false
		}
		return "[ P ] PREPARAR CANDIDATURA", "Preenche apenas dados confirmados e indica o CV certo; para antes do upload e da submissão.", true
	}
	return "[ ! ] CANAL POR CONFIRMAR", applicationBlockReason(app), false
}

func applicationMethodLabel(app model.CareerApplication) string {
	channel := strings.TrimSpace(app.ApplyChannel)
	status := strings.TrimSpace(app.ApplyStatus)
	if channel == "" {
		return "a confirmar"
	}
	if status == "" {
		return channel
	}
	return channel + " / " + status
}

func applicationBlockReason(app model.CareerApplication) string {
	if strings.TrimSpace(app.ApplyBlocker) != "" {
		return app.ApplyBlocker
	}
	if strings.TrimSpace(app.ApplyNext) != "" {
		return app.ApplyNext
	}
	return "Método de candidatura ou dados obrigatórios ainda não confirmados."
}

func isPortalApplyChannel(channel string) bool {
	switch strings.ToLower(strings.TrimSpace(channel)) {
	case "official_portal", "linkedin_apply", "job_board_apply", "manual_apply_url":
		return true
	default:
		return false
	}
}

func isBlockedApplyStatus(status string) bool {
	value := strings.ToLower(strings.TrimSpace(status))
	return value == "" || strings.HasPrefix(value, "blocked_") || strings.HasPrefix(value, "needs_")
}

func (m PipelineModel) overlayActionPicker(body string) string {
	bodyLines := strings.Split(body, "\n")

	pickerWidth := min(max(56, m.width-8), 100)
	padStyle := lipgloss.NewStyle().Padding(0, 2)
	borderStyle := lipgloss.NewStyle().
		Foreground(m.theme.Blue).
		Bold(true)
	warnStyle := lipgloss.NewStyle().Foreground(m.theme.Yellow)
	dimStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

	var picker []string
	picker = append(picker, padStyle.Render(borderStyle.Render("Leagle Job actions")))
	for i, action := range toolActions {
		prefix := "  "
		style := lipgloss.NewStyle().Foreground(m.theme.Text).Width(pickerWidth)
		if i == m.actionCursor {
			prefix = "> "
			style = style.Background(m.theme.Overlay).Bold(true)
		}
		writeTag := ""
		if action.Writes {
			writeTag = " [writes]"
		}
		label := fmt.Sprintf("%s%s%s - %s", prefix, action.Label, writeTag, action.Description)
		picker = append(picker, padStyle.Render(style.Render(ellipsize(label, pickerWidth))))
	}
	if m.actionConfirm {
		picker = append(picker, padStyle.Render(warnStyle.Render("This action writes files. Press Enter again to run.")))
	} else {
		picker = append(picker, padStyle.Render(dimStyle.Render("Preview actions do not write dashboard entries.")))
	}

	bodyLines = append(bodyLines, picker...)
	return strings.Join(bodyLines, "\n")
}
