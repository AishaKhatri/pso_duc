// dip-chart-service.js
const fs = require('fs').promises;
const path = require('path');
const { errorWithTimestamp, logWithTimestamp } = require('./backend-services');
const chalk = require('chalk');

class DipChartService {
    constructor() {
        // Cache structure: { [tankId]: { chartData: Array, filePath: string, lastModified: Date } }
        this.dipChartCache = new Map();
        
        // Cache TTL (1 hour)
        this.CACHE_TTL = 60 * 60 * 1000;
    }

    /**
     * Load dip chart data from CSV file
     * @param {string} filePath - Path to the CSV file
     * @returns {Promise<Array>} Array of {mm, liters} objects
     */
    async loadDipChart(filePath) {
        try {           
            // Check if file exists
            await fs.access(filePath);
            
            // Read file content
            const fileContent = await fs.readFile(filePath, 'utf-8');
            
            // Parse CSV
            const lines = fileContent.trim().split('\n');
            const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
            
            // Find column indices
            const mmIndex = headers.findIndex(h => h.includes('mm'));
            const litersIndex = headers.findIndex(h => h.includes('liters') || h.includes('litres'));
            
            if (mmIndex === -1 || litersIndex === -1) {
                throw new Error('CSV does not contain required mm and liters columns');
            }
            
            // Parse data rows
            const chartData = [];
            for (let i = 1; i < lines.length; i++) {
                const row = lines[i].split(',').map(cell => cell.trim());
                if (row.length > Math.max(mmIndex, litersIndex)) {
                    const mm = parseFloat(row[mmIndex]);
                    const liters = parseFloat(row[litersIndex]);
                    
                    if (!isNaN(mm) && !isNaN(liters)) {
                        chartData.push({ mm, liters });
                    }
                }
            }
            
            // Sort by mm in ascending order
            chartData.sort((a, b) => a.mm - b.mm);
            
            logWithTimestamp(chalk.blue, `Loaded dip chart from ${filePath}: ${chartData.length} data points`);
            return chartData;
        } catch (error) {
            errorWithTimestamp(`Error loading dip chart from ${filePath}:`, error.message);
            throw error;
        }
    }

    /**
     * Get or load dip chart data for a tank
     * @param {string} tankId - Tank identifier
     * @param {string} filePath - Path to dip chart CSV
     * @returns {Promise<Array>} Dip chart data
     */
    async getDipChartData(tankId, filePath) {
        try {
            const cached = this.dipChartCache.get(tankId);
            const now = Date.now();
            
            // Check if we have valid cached data
            if (cached && cached.filePath === filePath) {
                // Check file modification time
                try {                    
                    const stats = await fs.stat(filePath);
                    if (stats.mtime.getTime() === cached.lastModified.getTime() && 
                        (now - cached.cacheTime) < this.CACHE_TTL) {
                        return cached.chartData;
                    }
                } catch (error) {
                    // File may have been deleted, fall through to reload
                }
            }
            
            // Load fresh data
            const chartData = await this.loadDipChart(filePath);

            const stats = await fs.stat(filePath);
            
            // Update cache
            this.dipChartCache.set(tankId, {
                chartData,
                filePath,
                lastModified: stats.mtime,
                cacheTime: now
            });
            
            return chartData;
        } catch (error) {
            errorWithTimestamp(`Error getting dip chart data for tank ${tankId}:`, error.message);
            throw error;
        }
    }

    /**
     * Convert mm measurement to liters using dip chart
     * @param {number} mmValue - Measurement in millimeters
     * @param {Array} dipChartData - Dip chart data array
     * @returns {number|null} Converted value in liters or null if below threshold
     */
    convertMmToLiters(mmValue, dipChartData) {
        // Validate input
        if (isNaN(mmValue) || mmValue < 0) {
            throw new Error(`Invalid mm value: ${mmValue}`);
        }
        
        // Handle empty dip chart
        if (!dipChartData || dipChartData.length === 0) {
            throw new Error('Dip chart data is empty');
        }
        
        // Check if value is below minimum in chart
        if (mmValue < dipChartData[0].mm) {
            // Use first point (linear extrapolation from zero)
            const firstPoint = dipChartData[0];
            const ratio = mmValue / firstPoint.mm;
            return firstPoint.liters * ratio;
        }
        
        // Check if value is above maximum in chart
        if (mmValue > dipChartData[dipChartData.length - 1].mm) {
            // Use last point (may need to adjust based on tank shape)
            return dipChartData[dipChartData.length - 1].liters;
        }
        
        // Find the two points between which our value lies
        for (let i = 0; i < dipChartData.length - 1; i++) {
            const point1 = dipChartData[i];
            const point2 = dipChartData[i + 1];
            
            if (mmValue >= point1.mm && mmValue <= point2.mm) {
                // Linear interpolation
                const fraction = (mmValue - point1.mm) / (point2.mm - point1.mm);
                return point1.liters + fraction * (point2.liters - point1.liters);
            }
        }
        
        // Should not reach here if chart is properly sorted
        throw new Error('Could not interpolate value from dip chart');
    }

    /**
     * Clear cache for specific tank
     * @param {string} tankId - Tank identifier
     */
    clearCache(tankId) {
        if (tankId) {
            this.dipChartCache.delete(tankId);
            logWithTimestamp(chalk.yellow, `Cleared dip chart cache for tank ${tankId}`);
        } else {
            this.dipChartCache.clear();
            logWithTimestamp(chalk.yellow, 'Cleared all dip chart cache');
        }
    }

    /**
     * Get cache statistics
     * @returns {Object} Cache statistics
     */
    getCacheStats() {
        return {
            cacheSize: this.dipChartCache.size,
            cachedTanks: Array.from(this.dipChartCache.keys()),
            memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024 // MB
        };
    }

    /**
     * Preload dip charts for multiple tanks
     * @param {Array} tanks - Array of tank objects with tank_id and dip_chart_path
     */
    async preloadDipCharts(tanks) {
        const startTime = Date.now();
        let loadedCount = 0;
        let failedCount = 0;
        
        for (const tank of tanks) {
            if (tank.dip_chart_path) {
                try {
                    await this.getDipChartData(tank.tank_id, tank.dip_chart_path);
                    loadedCount++;
                    logWithTimestamp(null, `Preloaded dip chart for tank ${tank.tank_id}`);
                } catch (error) {
                    failedCount++;
                    errorWithTimestamp(`Failed to preload dip chart for tank ${tank.tank_id}:`, error.message);
                }
            }
        }
        
        const elapsedTime = Date.now() - startTime;
        logWithTimestamp(chalk.green, `Preloaded ${loadedCount} dip charts in ${elapsedTime}ms (${failedCount} failed)`);
    }
}

// Create singleton instance
const dipChartService = new DipChartService();

module.exports = dipChartService;