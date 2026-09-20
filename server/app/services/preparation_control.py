"""Cooperative cancellation is checked in bounded preparation loops."""
from contextlib import contextmanager
from contextvars import ContextVar
import time

from ..models.domain import DomainError


_control = ContextVar("timeline_preparation_control", default=None)


def checkpoint():
    control = _control.get()
    if control is not None:
        cancelled, deadline = control
        if cancelled.is_set():
            raise DomainError("preparation_cancelled", "Preparation was cancelled.", 409)
        if time.monotonic() >= deadline:
            raise DomainError("preparation_timeout", "Preparation exceeded its 30-second publication deadline.", 408)


def checked(values):
    for index, value in enumerate(values):
        if index % 64 == 0:
            checkpoint()
        yield value
    checkpoint()


class _LockLease:
    def __init__(self, lock, check):
        self.lock, self.check, self.held = lock, check, False

    def acquire(self):
        self.check()
        while not self.lock.acquire(timeout=.025):
            self.check()
        self.held = True
        self.check()

    def release(self):
        if self.held:
            self.held = False
            self.lock.release()

    def yield_until(self, waiting):
        """Yield between immutable file images, preserving cancellation-safe ownership."""
        if not waiting():
            return
        self.release()
        while waiting():
            self.check()
            time.sleep(.01)
        self.acquire()


@contextmanager
def cancellable_lock(lock, cancel=None, deadline=None):
    """Check cancellation while waiting, including readers outside query jobs."""
    def check():
        checkpoint()
        if cancel is not None and cancel.is_set():
            raise DomainError("legacy_cancelled", "Legacy read was cancelled.", 409)
        if deadline is not None and time.monotonic() >= deadline:
            raise DomainError("legacy_scan_timeout", "Legacy read exceeded its configured time budget.", 503)
    lease = _LockLease(lock, check)
    try:
        lease.acquire()
        yield lease
    finally:
        lease.release()


@contextmanager
def preparation_control(cancelled, deadline):
    token = _control.set((cancelled, deadline))
    try:
        checkpoint()
        yield
        checkpoint()
    finally:
        _control.reset(token)
