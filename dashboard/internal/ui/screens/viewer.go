package screens

import (
	"os"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/santifer/career-ops/dashboard/internal/theme"
)

// ViewerClosedMsg is emitted when the viewer is dismissed.
type ViewerClosedMsg struct{}

// ViewerModel implements an integrated file viewer screen.
type ViewerModel struct {
	lines        []string
	title        string
	scrollOffset int
	width        int
	height       int
	theme        theme.Theme
}

type viewerLine struct {
	text   string
	source string
}

// NewViewerModel creates a new file viewer for the given path.
func NewViewerModel(t theme.Theme, path, title string, width, height int) ViewerModel {
	content, err := os.ReadFile(path)
	if err != nil {
		content = []byte("Error reading file: " + err.Error())
	}

	return ViewerModel{
		lines:  strings.Split(string(content), "\n"),
		title:  title,
		width:  width,
		height: height,
		theme:  t,
	}
}

func (m ViewerModel) Init() tea.Cmd {
	return nil
}

func (m *ViewerModel) Resize(width, height int) {
	m.width = width
	m.height = height
	m.clampScroll()
}

func (m ViewerModel) Update(msg tea.Msg) (ViewerModel, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "esc":
			return m, func() tea.Msg { return ViewerClosedMsg{} }

		case "down", "j":
			maxScroll := m.maxScroll()
			if m.scrollOffset < maxScroll {
				m.scrollOffset++
			}

		case "up", "k":
			if m.scrollOffset > 0 {
				m.scrollOffset--
			}

		case "pgdown", "ctrl+d":
			jump := m.bodyHeight() / 2
			maxScroll := m.maxScroll()
			m.scrollOffset += jump
			if m.scrollOffset > maxScroll {
				m.scrollOffset = maxScroll
			}

		case "pgup", "ctrl+u":
			jump := m.bodyHeight() / 2
			m.scrollOffset -= jump
			if m.scrollOffset < 0 {
				m.scrollOffset = 0
			}

		case "home", "g":
			m.scrollOffset = 0

		case "end", "G":
			m.scrollOffset = m.maxScroll()
		}

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.clampScroll()
	}

	return m, nil
}

func (m ViewerModel) bodyHeight() int {
	h := m.height - 4 // header + footer + padding
	if h < 3 {
		h = 3
	}
	return h
}

func (m ViewerModel) contentWidth() int {
	w := m.width - 4
	if w < 12 {
		w = 12
	}
	return w
}

func (m ViewerModel) visualLines() []viewerLine {
	width := m.contentWidth()
	if len(m.lines) == 0 {
		return nil
	}

	visual := make([]viewerLine, 0, len(m.lines))
	for _, line := range m.lines {
		wrapped := wrapText(line, width)
		if len(wrapped) == 0 {
			visual = append(visual, viewerLine{text: "", source: line})
			continue
		}
		for _, row := range wrapped {
			visual = append(visual, viewerLine{text: row, source: line})
		}
	}
	return visual
}

func (m ViewerModel) maxScroll() int {
	maxScroll := len(m.visualLines()) - m.bodyHeight()
	if maxScroll < 0 {
		return 0
	}
	return maxScroll
}

func (m *ViewerModel) clampScroll() {
	maxScroll := m.maxScroll()
	if m.scrollOffset > maxScroll {
		m.scrollOffset = maxScroll
	}
	if m.scrollOffset < 0 {
		m.scrollOffset = 0
	}
}

func (m ViewerModel) View() string {
	header := m.renderHeader()
	body := m.renderBody()
	footer := m.renderFooter()

	return lipgloss.JoinVertical(lipgloss.Left, header, body, footer)
}

func (m ViewerModel) renderHeader() string {
	titleText := ellipsize(m.title, max(12, m.width-14))
	style := lipgloss.NewStyle().
		Bold(true).
		Foreground(m.theme.Text).
		Background(m.theme.Surface).
		Width(m.width).
		Padding(0, 2)

	title := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Blue).Render(titleText)

	right := lipgloss.NewStyle().Foreground(m.theme.Subtext)
	pos := right.Render(strings.TrimRight(
		strings.Repeat(" ", max(0, m.width-lipgloss.Width(m.title)-30)),
		" ",
	))

	lineInfo := right.Render(
		strings.Join([]string{
			"L",
			strings.TrimSpace(lipgloss.NewStyle().Render(
				strings.Join([]string{
					func() string {
						s := m.scrollOffset + 1
						if s > len(m.lines) {
							s = len(m.lines)
						}
						return string(rune('0'+s/100%10)) + string(rune('0'+s/10%10)) + string(rune('0'+s%10))
					}(),
				}, ""),
			)),
			"/",
			func() string {
				t := len(m.lines)
				return string(rune('0'+t/100%10)) + string(rune('0'+t/10%10)) + string(rune('0'+t%10))
			}(),
		}, ""),
	)
	_ = pos
	_ = lineInfo

	scroll := right.Render(func() string {
		if len(m.lines) == 0 {
			return ""
		}
		pct := 0
		maxScroll := m.maxScroll()
		if maxScroll > 0 {
			pct = m.scrollOffset * 100 / maxScroll
		}
		if m.scrollOffset == 0 {
			return "Top"
		}
		if m.scrollOffset >= maxScroll {
			return "End"
		}
		return func() string {
			s := pct
			return string(rune('0'+s/10%10)) + string(rune('0'+s%10)) + "%"
		}()
	}())

	gap := m.width - lipgloss.Width(titleText) - lipgloss.Width(scroll) - 4
	if gap < 1 {
		gap = 1
	}

	return style.Render(title + strings.Repeat(" ", gap) + scroll)
}

func (m ViewerModel) renderBody() string {
	bh := m.bodyHeight()
	padStyle := lipgloss.NewStyle().Padding(0, 2)
	visual := m.visualLines()

	if len(visual) == 0 {
		emptyStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)
		return padStyle.Render(emptyStyle.Render("(empty file)"))
	}

	end := m.scrollOffset + bh
	if end > len(visual) {
		end = len(visual)
	}
	visible := visual[m.scrollOffset:end]

	// Style markdown elements
	var styled []string
	for _, line := range visible {
		styled = append(styled, m.styleLine(line.text, line.source))
	}

	// Pad to fill height
	for len(styled) < bh {
		styled = append(styled, "")
	}

	return padStyle.Render(strings.Join(styled, "\n"))
}

func (m ViewerModel) styleLine(line, source string) string {
	trimmed := strings.TrimSpace(source)

	// H1
	if strings.HasPrefix(trimmed, "# ") {
		return lipgloss.NewStyle().
			Bold(true).
			Foreground(m.theme.Blue).
			Render(line)
	}
	// H2
	if strings.HasPrefix(trimmed, "## ") {
		return lipgloss.NewStyle().
			Bold(true).
			Foreground(m.theme.Mauve).
			Render(line)
	}
	// H3
	if strings.HasPrefix(trimmed, "### ") {
		return lipgloss.NewStyle().
			Bold(true).
			Foreground(m.theme.Sky).
			Render(line)
	}
	// Horizontal rule
	if trimmed == "---" || trimmed == "***" {
		return lipgloss.NewStyle().
			Foreground(m.theme.Overlay).
			Render(strings.Repeat("─", m.contentWidth()))
	}
	// Bold fields like **Score:** 4.0/5
	if strings.HasPrefix(trimmed, "**") && strings.Contains(trimmed, ":**") {
		return lipgloss.NewStyle().
			Foreground(m.theme.Yellow).
			Render(line)
	}
	// Table headers/separators
	if strings.HasPrefix(trimmed, "|") && strings.Contains(trimmed, "---") {
		return lipgloss.NewStyle().
			Foreground(m.theme.Overlay).
			Render(line)
	}
	// Table rows
	if strings.HasPrefix(trimmed, "|") {
		return lipgloss.NewStyle().
			Foreground(m.theme.Text).
			Render(line)
	}
	// Bullet points
	if strings.HasPrefix(trimmed, "- ") || strings.HasPrefix(trimmed, "* ") {
		return lipgloss.NewStyle().
			Foreground(m.theme.Text).
			Render(line)
	}

	// Default
	return lipgloss.NewStyle().
		Foreground(m.theme.Subtext).
		Render(line)
}

func (m ViewerModel) renderFooter() string {
	style := lipgloss.NewStyle().
		Foreground(m.theme.Subtext).
		Background(m.theme.Surface).
		Width(m.width).
		Padding(0, 1)

	keyStyle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Text)
	descStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

	help := keyStyle.Render("↑↓") + descStyle.Render(" scroll  ") +
		keyStyle.Render("PgUp/Dn") + descStyle.Render(" page  ") +
		keyStyle.Render("g/G") + descStyle.Render(" top/end  ") +
		keyStyle.Render("Esc") + descStyle.Render(" back")

	if lipgloss.Width(help) > m.width-2 {
		help = keyStyle.Render("↑↓") + descStyle.Render(" scroll  ") +
			keyStyle.Render("Pg") + descStyle.Render(" page  ") +
			keyStyle.Render("Esc") + descStyle.Render(" back")
	}

	return style.Render(help)
}
