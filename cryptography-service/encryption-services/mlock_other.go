//go:build !linux

package main

import "errors"

var errNotSupported = errors.New("mlock not supported on this platform")

func lockMem(b []byte) error { return errNotSupported }

func unlockMem(b []byte) {}

func disableCoreDumps() error { return errNotSupported }
