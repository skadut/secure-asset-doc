//go:build linux

package main

import "golang.org/x/sys/unix"

func lockMem(b []byte) error { return unix.Mlock(b) }

func unlockMem(b []byte) { _ = unix.Munlock(b) }

func disableCoreDumps() error {
	return unix.Setrlimit(unix.RLIMIT_CORE, &unix.Rlimit{Cur: 0, Max: 0})
}
