import org.jetbrains.intellij.platform.gradle.TestFrameworkType

plugins {
    id("java")
    id("org.jetbrains.intellij.platform") version "2.1.0"
}

group = "dev.latent"
version = "1.0.0"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        create("IC", "2024.2")
        testFramework(TestFrameworkType.Platform)
    }
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.opentest4j:opentest4j:1.3.0")
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
    options.release.set(17)
}

intellijPlatform {
    // Не запускаем headless IDE для индексации настроек: ускоряет сборку и не требует GUI.
    buildSearchableOptions = false
    instrumentCode = false

    pluginConfiguration {
        id = "dev.latent.idea"
        name = "Latent"
        version = project.version.toString()
        ideaVersion {
            sinceBuild = "233"
            untilBuild = "243.*"
        }
        vendor {
            name = "Latent Language"
            url = "https://github.com/jegius/latent"
            email = "latent@github.invalid"
        }
        description = """
            Полноценная поддержка языка Latent в IntelliJ IDEA: подсветка синтаксиса,
            автодополнение (ключевые слова, типы, builtins, сниппеты), аннотации ошибок,
            сворачивание кода, отступы, структура файла и запуск программ через latentc
            (с fallback на web-ide/compiler.wasm).
        """.trimIndent()
        changeNotes = """
            <ul>
              <li>1.0.0 — первая версия: лексер, подсветка, completion, аннотатор, folding,
                  structure view, settings и run configuration для Latent.</li>
            </ul>
        """.trimIndent()
    }
}

tasks.test {
    useJUnit()
    // Тесты на BasePlatformTestCase не должны пытаться открыть GUI на CI.
    systemProperty("java.awt.headless", "true")
    testLogging {
        events("passed", "failed", "skipped")
    }
}

