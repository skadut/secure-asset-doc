//go:build windows

package tpm

import (
	"golang.org/x/sys/windows"
	"unsafe"
)

func LockMemory(b []byte) error {
	if len(b) == 0 {
		return nil
	}
	return windows.VirtualLock(uintptr(unsafe.Pointer(&b[0])), uintptr(len(b)))
}

func UnlockMemory(b []byte) {
	if len(b) != 0 {
		_ = windows.VirtualUnlock(uintptr(unsafe.Pointer(&b[0])), uintptr(len(b)))
	}
}
