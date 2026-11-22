package com.localtube.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class PlaybackProgressTest {
    @Test public void marksVideoCompleteAtNinetyPercent() {
        assertTrue(PlaybackProgress.isCompleted(90000L, 100000L));
        assertFalse(PlaybackProgress.isCompleted(89999L, 100000L));
    }

    @Test public void rejectsUnknownDuration() {
        assertFalse(PlaybackProgress.isCompleted(1000L, 0L));
    }

    @Test public void resetsResumePositionAfterCompletion() {
        assertEquals(0L, PlaybackProgress.safeResumePosition(95000L, 100000L));
    }

    @Test public void preservesPartialResumePosition() {
        assertEquals(45000L, PlaybackProgress.safeResumePosition(45000L, 100000L));
    }

    @Test public void doesNotResumeWhenPositionExceedsDuration() {
        // A position beyond the duration is invalid; treat it as completed and restart.
        assertEquals(0L, PlaybackProgress.safeResumePosition(120000L, 100000L));
    }
}
