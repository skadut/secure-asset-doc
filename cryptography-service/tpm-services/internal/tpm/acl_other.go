//go:build !windows

package tpm

// RestrictToCurrentUser is a no-op off Windows; POSIX modes handle permissions.
func RestrictToCurrentUser(path string, isDir bool) error { return nil }
