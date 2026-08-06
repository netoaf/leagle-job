package screens

import (
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"
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
