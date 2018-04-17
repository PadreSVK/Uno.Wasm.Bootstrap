﻿var debug = false;


function unoWasmMain(mainAsmName, mainNamespace, mainClassName, mainMethodName, assemblies, isDebug) {
    Module.entryPoint = { "a": mainAsmName, "n": mainNamespace, "t": mainClassName, "m": mainMethodName };
    Module.assemblies = assemblies;
    debug = isDebug;
}

var Module = {
    onRuntimeInitialized: function () {
        if (debug) console.log("Done with WASM module instantiation.");

        Module.FS_createPath("/", "managed", true, true);

        var pending = 0;
        this.assemblies.forEach(function (asm_name) {
            if (debug) console.log("Loading", asm_name);
            ++pending;
            fetch("managed/" + asm_name, { credentials: 'same-origin' }).then(function (response) {
                if (!response.ok)
                    throw "failed to load Assembly '" + asm_name + "'";
                return response['arrayBuffer']();
            }).then(function (blob) {
                var asm = new Uint8Array(blob);
                Module.FS_createDataFile("managed/" + asm_name, null, asm, true, true, true);
                --pending;
                if (pending == 0)
                    Module.bclLoadingDone();
            });
        });
    },

    bclLoadingDone: function () {
        if (debug) console.log("Done loading the BCL.");
        MonoRuntime.init();
    }
};

var MonoRuntime = {
    init: function () {
        this.load_runtime = Module.cwrap('mono_wasm_load_runtime', null, ['string', 'number']);
        this.assembly_load = Module.cwrap('mono_wasm_assembly_load', 'number', ['string']);
        this.find_class = Module.cwrap('mono_wasm_assembly_find_class', 'number', ['number', 'string', 'string']);
        this.find_method = Module.cwrap('mono_wasm_assembly_find_method', 'number', ['number', 'string', 'number']);
        this.invoke_method = Module.cwrap('mono_wasm_invoke_method', 'number', ['number', 'number', 'number']);
        this.mono_string_get_utf8 = Module.cwrap('mono_wasm_string_get_utf8', 'number', ['number']);
        this.mono_string = Module.cwrap('mono_wasm_string_from_js', 'number', ['string']);

        this.load_runtime("managed", 1);

        if (debug) console.log("Done initializing the runtime.");

        WebAssemblyApp.init();
    },

    conv_string: function (mono_obj) {
        if (mono_obj == 0)
            return null;
        var raw = this.mono_string_get_utf8(mono_obj);
        var res = Module.UTF8ToString(raw);
        Module._free(raw);

        return res;
    },

    call_method: function (method, this_arg, args) {
        var args_mem = Module._malloc(args.length * 4);
        var eh_throw = Module._malloc(4);
        for (var i = 0; i < args.length; ++i)
            Module.setValue(args_mem + i * 4, args[i], "i32");
        Module.setValue(eh_throw, 0, "i32");

        var res = this.invoke_method(method, this_arg, args_mem, eh_throw);

        var eh_res = Module.getValue(eh_throw, "i32");

        Module._free(args_mem);
        Module._free(eh_throw);

        if (eh_res != 0) {
            var msg = this.conv_string(res);
            throw new Error(msg);
        }

        return res;
    },
};

var WebAssemblyApp = {
    init: function () {
        this.loading = document.getElementById("loading");

        this.findMethods();

        this.runApp();

        this.loading.hidden = true;
    },

    runApp: function () {
        try {
            MonoRuntime.call_method(this.main_method, null, []);
        } catch (e) {
            console.error(e);
        }
    },

    findMethods: function () {
        this.main_module = MonoRuntime.assembly_load(Module.entryPoint.a);
        if (!this.main_module)
            throw "Could not find Main Module " + Module.entryPoint.a + ".dll";

        this.main_class = MonoRuntime.find_class(this.main_module, Module.entryPoint.n, Module.entryPoint.t)
        if (!this.main_class)
            throw "Could not find Program class in main module";

        this.main_method = MonoRuntime.find_method(this.main_class, Module.entryPoint.m, -1)
        if (!this.main_method)
            throw "Could not find Main method";
    },
};
