import path from 'path';
import fs from 'fs';

/**
 * Node.JS modules ignored in the resolveId method by default
 * TODO use https://www.npmjs.com/package/builtin-modules
 */
const externalModules = ['assert', 'buffer', 'console', 'constants', 'crypto',
    'domain', 'events', 'http', 'https', 'os', 'path', 'punycode', 'querystring',
    'stream', 'string_decoder', 'timers', 'tty', 'url', 'util', 'vm', 'zlib'];

const defaultExtensions = ['.js', '.json'];

class RollupIncludePaths {
    /**
     * Options:
     *
     * - paths
     * An array of source paths in your project where the plugin should look for files
     * Example: ['src/lib', 'src/foo']
     *
     * - include
     * A map of module=>path/to/file.js with custom module paths. Used to override
     * the search with a static path (like Browserify does with the "browser" config)
     *
     * - external
     * An array of module names that should be excluded from the bundle
     *
     * - extensions
     * An array of file extensions to look for in the project.
     * Default: ['.js', '.json']
     *
     * @param {Object} options
     */
    constructor(options) {
        options = options || {};

        // include paths
        this.projectPaths = options.paths || [''];

        this.cache = {};
        if (options.include) {
            this.copyStaticPathsToCache(options.include);
        }

        // external modules to ignore
        this.externalModules = options.external || externalModules;

        // file extensions
        this.extensions = options.extensions || defaultExtensions;
        let extensionMatchers = this.extensions.map(e => e.replace('.', '\\.')).join('|');

        this.HAS_EXTENSION = RegExp('(' + extensionMatchers + ')$');
    }

    /**
     * Rollup plugin method. Implements the Module resolution for project
     * files
     *
     * @param {string} file         File path to search
     * @param {string} [origin]     Origin of the module request
     */
    resolveId(id, origin) {
        origin = origin || false;
        return this.resolveCachedPath(id) || this.searchModule(id, origin);
    }

    /**
     * Rollup plugin method. Modifies the "external" by adding the Node.JS
     * module names to it.
     *
     * @param {Object} options
     */
    options(options) {
        if (this.externalModules.length) {
            options.external = (options.external||[])
                .concat(this.externalModules);
        }

        return options;
    }

    /**
     * Receives an object with { moduleName => fullPath }
     *
     * Used to override resolution process with static values, like the
     * `browser` config in Browserify
     *
     * If the path has no file extension, ".js" is implied
     *
     * @param {Object} paths
     */
    copyStaticPathsToCache (staticPaths) {
        let cache = this.cache;

        Object.keys(staticPaths).forEach(function (id) {
            var modulePath = staticPaths[id];
            cache[id] = resolveJsExtension(modulePath);
        });

        /**
         * Add '.js' to the end of file path
         * @param {string} file
         * @return {string}
         */
        function resolveJsExtension (file) {
            if (/\.js$/.test(file) === false) {
                file += '.js';
            }

            return file;
        }
    }

    /**
     * Return a path from cache
     * @param {string} id
     * @return {string|nulld}
     */
    resolveCachedPath (id) {
        if (id in this.cache) {
            return this.cache[id];
        }

        return false;
    }

    /**
     * @param {string} file         File path to search
     * @param {string} [origin]     Origin of the module request
     */
    searchModule (file, origin) {
        let newPath =
            this.searchRelativePath(file, origin) ||
            this.searchProjectModule(file, origin);

        if (newPath) {
            // add result to cache
            this.cache[file] = newPath;
            return newPath;
        }

        // if no path was found, null must be returned to keep the
        // plugin chain!
        return null;
    }

    /**
     * Sarch for a file in the defined include paths
     *
     * @param {string} file         File path to search
     * @param {string} [origin]     Origin of the module request
     * @return {string|null}
     */
    searchProjectModule (file) {
        let newPath;
        let includePath = this.projectPaths;
        let workingDir = process.cwd();

        for (let i = 0, ii = includePath.length; i < ii ; i++) {
            newPath = this.resolvePath(path.resolve(workingDir, includePath[i], file), true);
            if (newPath) return newPath;

            // #1 - also check for 'path/to/file' + 'index.js'
            newPath = this.resolvePath(path.resolve(workingDir, includePath[i], file, 'index.js'), false);
            if (newPath) return newPath;
        }

        return null;
    }

    /**
     * Sarch for a file relative to who required it
     *
     * @param {string} file         File path to search
     * @param {string} [origin]     Origin of the module request
     */
    searchRelativePath (file, origin) {
        if (!origin) {
            return null;
        }

        let basePath = path.dirname(origin);

        return (
            // common case
            // require('./file.js') in 'path/origin.js'
            // > path/file.js
            this.resolvePath(path.join(basePath, file), true) ||

            // nodejs path case
            // require('./subfolder') in 'lib/origin.js'
            // > lib/subfolder/index.js
            this.resolvePath(path.join(basePath, file, 'index.js'), false)
        );
    }

    /**
     * Resolve a given file path by checking if it exists and
     * optionally also checking if it exists if an extension is
     * appended to file name.
     *
     * If checkExtensions is true, checks for 'file', then 'file.js', 'file.json'
     * and so on, until one is found.
     *
     * Returns false if "file" was not found
     *
     * @param {string} file
     * @param {boolean} [checkExtensions=false]
     * @return {boolean}
     */
    resolvePath (file, checkExtensions) {
        if (this.fileExists(file)) {
            return file;
        }

        if (checkExtensions) {
            for (let i = 0, ii = this.extensions.length; i < ii; i++ ) {
                let ext = this.extensions[i];
                let newPath = file + ext;

                if (this.fileExists(newPath)) {
                    return newPath;
                }
            }
        }

        return false;
    }

    /**
     * Check if "file" has one of the extensions defined in the plugin options
     * @param {string} file
     * @return {boolean}
     */
    hasExtension (file) {
        return this.HAS_EXTENSION.test(file);
    }

    /**
     * @param {string} file
     * @return {boolean}
     */
    fileExists (file) {
        try {
            let stat = fs.statSync(file);
            return stat.isFile();
        } catch (e) {
            return false;
        }
    }
}

export default function plugin(options) {
    let resolver = new RollupIncludePaths(options);

    return {
        resolveId: function (file, origin) {
            return resolver.resolveId(file, origin);
        },

        options: function (options) {
            return resolver.options(options);
        }
    };
}
