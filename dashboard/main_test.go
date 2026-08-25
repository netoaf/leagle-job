package main

import (
	"reflect"
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/ui/screens"
)

func TestDraftActionCommandTargetsOneApplication(t *testing.T) {
	action := screens.PipelineToolAction{
		ID:            "create_draft",
		ApplicationID: 42,
	}
	args, ok := actionCommandArgs(action)
	if !ok {
		t.Fatal("expected create_draft action to be supported")
	}
	want := []string{"--silent", "run", "gmail-draft-live", "--", "--id", "42"}
	if !reflect.DeepEqual(args, want) {
		t.Fatalf("unexpected arguments: got %#v want %#v", args, want)
	}
}

func TestDraftActionRejectsMissingApplication(t *testing.T) {
	if _, ok := actionCommandArgs(screens.PipelineToolAction{ID: "create_draft"}); ok {
		t.Fatal("expected create_draft without application id to be rejected")
	}
}
