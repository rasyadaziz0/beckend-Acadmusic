export class TimezoneResolver {
  // Common timezones to check against
  private static readonly SUPPORTED_TIMEZONES = [
    'Asia/Jakarta', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Shanghai',
    'Asia/Singapore', 'Asia/Kuala_Lumpur', 'Asia/Bangkok', 'Asia/Manila',
    'Asia/Kolkata', 'Australia/Sydney', 'Europe/London', 'Europe/Paris',
    'Europe/Berlin', 'Europe/Rome', 'Europe/Madrid', 'America/New_York',
    'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Toronto', 'America/Sao_Paulo', 'America/Mexico_City',
    'Pacific/Auckland',
  ];

  /**
   * Returns an array of IANA timezone strings where the current local time
   * is Monday 12:00 AM (Midnight).
   */
  static getTimezonesAtMondayMidnight(now?: Date): string[] {
    const checkDate = now ?? new Date();
    
    // As a fallback to ensure we cover any missing timezones, we dynamically add
    // the system's list of supported timezones (if available in Node)
    let allZones = [...this.SUPPORTED_TIMEZONES];
    if (typeof Intl !== 'undefined' && typeof (Intl as any).supportedValuesOf === 'function') {
      try {
        allZones = (Intl as any).supportedValuesOf('timeZone');
      } catch (e) {
        // Fallback to static list
      }
    }

    // Deduplicate just in case
    const uniqueZones = Array.from(new Set(allZones));

    return uniqueZones.filter(tz => {
      try {
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          weekday: 'short',
          hour: 'numeric',
          hourCycle: 'h23',
        });
        const parts = formatter.formatToParts(checkDate);
        const weekday = parts.find(p => p.type === 'weekday')?.value;  // "Mon"
        const hour = parts.find(p => p.type === 'hour')?.value;        // "0"
        
        return weekday === 'Mon' && hour === '0';
      } catch (e) {
        // Skip invalid timezones
        return false;
      }
    });
  }
}
