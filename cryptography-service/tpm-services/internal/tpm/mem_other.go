//go:build !windows

package tpm

func LockMemory([]byte) error { return nil }
func UnlockMemory([]byte)     {}
