package screens

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

func TestWrapTextKeepsRowsWithinWidth(t *testing.T) {
	width := 24
	input := strings.Join([]string{
		"Antes de enviar a candidatura final, gostaria de confirmar elegibilidade.",
		"https://job-boards.greenhouse.io/celonis/jobs/7777600003?gh_jid=7777600003",
		"palavramuitocompridaquenaodevepassardalarguradisponivel",
	}, " ")

	rows := wrapText(input, width)
	if len(rows) == 0 {
		t.Fatal("expected wrapped rows")
	}

	for _, row := range rows {
		if got := lipgloss.Width(row); got > width {
			t.Fatalf("row width %d exceeds limit %d: %q", got, width, row)
		}
	}
}

func TestDraftKeyTargetsSelectedApplication(t *testing.T) {
	apps := []model.CareerApplication{{
		Number:         42,
		Company:        "Empresa",
		Role:           "Programador Júnior",
		Status:         "Evaluated",
		Score:          90,
		ReportPath:     "reports/042.md",
		ApplyChannel:   "email",
		ApplyRecipient: "recrutamento@example.com",
		ApplyStatus:    "ready_email_draft",
	}}
	m := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{}, ".", 120, 40)

	updated, cmd := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'d'}})
	if cmd == nil {
		t.Fatal("expected draft command")
	}
	if !updated.actionRunning {
		t.Fatal("expected draft action to be marked as running")
	}

	msg, ok := cmd().(PipelineRunActionMsg)
	if !ok {
		t.Fatalf("expected PipelineRunActionMsg, got %T", cmd())
	}
	if msg.Action.ID != "create_draft" || msg.Action.ApplicationID != 42 {
		t.Fatalf("unexpected draft action: %#v", msg.Action)
	}
}

func TestPortalKeyTargetsSelectedApplication(t *testing.T) {
	apps := []model.CareerApplication{{
		Number:       72,
		Company:      "Capgemini Engineering",
		Role:         "Curricular Internship - Testing",
		Status:       "Evaluated",
		ApplyChannel: "official_portal",
		ApplyStatus:  "ready_portal_prepare",
	}}
	m := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{}, ".", 120, 40)

	updated, cmd := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'p'}})
	if cmd == nil || !updated.actionRunning {
		t.Fatal("expected portal preparation command")
	}
	msg, ok := cmd().(PipelineRunActionMsg)
	if !ok || msg.Action.ID != "prepare_application" || msg.Action.ApplicationID != 72 {
		t.Fatalf("unexpected portal action: %#v", msg)
	}
	_, description, enabled := applicationButton(apps[0])
	if !enabled || !strings.Contains(strings.ToLower(description), "indica") || strings.Contains(strings.ToLower(description), "anexa") {
		t.Fatalf("portal action must stop before upload, got %q", description)
	}
}

func TestWriteActionRequiresSecondEnterConfirmation(t *testing.T) {
	m := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), nil, model.PipelineMetrics{}, ".", 120, 40)

	m, cmd := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'a'}})
	if cmd != nil || !m.actionPicker {
		t.Fatal("expected action picker to open without running a command")
	}

	m, _ = m.Update(tea.KeyMsg{Type: tea.KeyDown})
	m, _ = m.Update(tea.KeyMsg{Type: tea.KeyDown})
	m, cmd = m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	if cmd != nil || !m.actionConfirm || !m.actionPicker {
		t.Fatal("expected first Enter on a write action to request confirmation")
	}

	m, cmd = m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	if cmd == nil || m.actionPicker || !m.actionRunning {
		t.Fatal("expected second Enter to run the confirmed action")
	}
	msg, ok := cmd().(PipelineRunActionMsg)
	if !ok || msg.Action.ID != "search_pt_write" {
		t.Fatalf("unexpected confirmed action: %#v", msg)
	}
}

func TestPrimaryHelpOnlyShowsNecessaryKeys(t *testing.T) {
	apps := []model.CareerApplication{{
		Number:         42,
		Company:        "Empresa",
		Role:           "Programador Júnior",
		Status:         "Evaluated",
		ApplyChannel:   "email",
		ApplyRecipient: "recrutamento@example.com",
		ApplyStatus:    "ready_email_draft",
	}}
	m := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{}, ".", 120, 40)
	help := m.renderHelp()

	for _, expected := range []string{"↑↓", "←→", "Enter", "criar draft", "abrir vaga", "estado", "sair"} {
		if !strings.Contains(help, expected) {
			t.Fatalf("help is missing %q: %q", expected, help)
		}
	}
	for _, hidden := range []string{"sort", "refresh", "actions", " view "} {
		if strings.Contains(help, hidden) {
			t.Fatalf("help should not show advanced key %q: %q", hidden, help)
		}
	}
}
