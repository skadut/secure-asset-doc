//go:build windows

package main

import (
	"os"

	"golang.org/x/sys/windows"
)

// keyModeEnter turns off line input and echo so a single keypress is readable, while
// keeping Ctrl+C as a console signal. It returns a restore function.
func keyModeEnter(f *os.File) (func(), error) {
	h := windows.Handle(f.Fd())
	var old uint32
	if err := windows.GetConsoleMode(h, &old); err != nil {
		return nil, err
	}
	mode := old &^ (windows.ENABLE_LINE_INPUT | windows.ENABLE_ECHO_INPUT)
	mode |= windows.ENABLE_PROCESSED_INPUT
	if err := windows.SetConsoleMode(h, mode); err != nil {
		return nil, err
	}
	return func() { _ = windows.SetConsoleMode(h, old) }, nil
}
